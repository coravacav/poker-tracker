// Room lifecycle maintenance, run by the daily cron as a chain of small
// batches (see `runRoomLifecycle` in convex/rooms.ts):
//
// 1. Active rooms idle for 7 days are expired (friend listing removed, legacy
//    profile pointer cleared, active-room slot released).
// 2. Rooms ended or expired over 30 days ago have their details pruned
//    (processed actions, audit events, notification cursors) and their guest
//    records pruned (every guest request and revoked guest session; guests in
//    good standing are kept so they can still review the room). Each room is
//    marked with `detailsPrunedAt` / `guestRecordsPrunedAt` once drained.
//
// Transaction budget. Convex limits a mutation to 16 MiB read, 16 MiB written,
// 32,000 documents read, 16,000 documents written and 4,096 index ranges
// (https://docs.convex.dev/production/state/limits). Room documents carry the
// game snapshot (up to MAX_ROOM_SNAPSHOT_BYTES = 700,000 bytes of JSON), and
// Convex has no index-only reads, so selecting a room through any index loads
// the whole document. The batch math therefore charges every room the 1 MiB
// Convex document cap, the only bound that holds regardless of how the
// snapshot encodes:
//
//   room visit   = select (1 MiB read) + one patch (1 MiB read, 1 MiB written)
//                  + small side documents (counter, listing, profile)
//   rooms/batch  = floor(8 MiB / (2 MiB + 64 KiB)) = 3
//
// Child rows (details and guest records) vary in size, so they are deleted one
// at a time with a live check of `ctx.meta.getTransactionMetrics()` that
// always keeps room for one more worst-case child (read + delete re-read) plus
// the pending patch of the current room. Every batch thus stays within half of
// the read and write limits, and at most MAX_CHILD_DOCUMENTS_PER_BATCH rows
// are deleted (about 6% of the document limits).
//
// Chains. A batch that may have left work behind schedules a continuation.
// A lease row names the one chain allowed to run: a cron start while a chain
// is live is a no-op, a continuation whose token no longer owns the lease
// stops, and a chain that died (e.g. a failed batch) is taken over by the next
// start once its lease has not been renewed for LEASE_TTL_MS. Lease reads and
// writes are part of each batch's transaction, so two chains can never both
// pass the check.
import { v } from "convex/values";
import type { Doc, Id, TableNames } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { decrementActiveRoomCounter } from "./creationLimits";
import { clearLegacyActiveRoom, syncFriendRoomListing } from "./friendDiscovery";

const DAY_MS = 24 * 60 * 60 * 1000;
const MiB = 1 << 20;

export const ACTIVE_ROOM_IDLE_MS = 7 * DAY_MS;
export const ENDED_DETAIL_RETENTION_MS = 30 * DAY_MS;

/** Convex per-transaction limits for queries and mutations. */
export const CONVEX_TRANSACTION_LIMITS = {
  bytesRead: 16 * MiB,
  bytesWritten: 16 * MiB,
  documentsRead: 32_000,
  documentsWritten: 16_000,
  databaseQueries: 4_096
} as const;

/** Convex rejects documents over 1 MiB, so no single read or write exceeds it. */
export const MAX_DOCUMENT_BYTES = MiB;

/** Each batch keeps to half of the Convex byte limits. */
export const BATCH_BYTES_READ_BUDGET = CONVEX_TRANSACTION_LIMITS.bytesRead / 2;
export const BATCH_BYTES_WRITTEN_BUDGET = CONVEX_TRANSACTION_LIMITS.bytesWritten / 2;

/** Allowance for the small documents touched alongside a room. */
export const ROOM_SIDE_DOCUMENT_BYTES = 64 * 1024;
/** Selecting a room, then patching it once (a patch re-reads the document). */
export const ROOM_VISIT_BYTES_READ = 2 * MAX_DOCUMENT_BYTES + ROOM_SIDE_DOCUMENT_BYTES;
export const ROOM_VISIT_BYTES_WRITTEN = MAX_DOCUMENT_BYTES + ROOM_SIDE_DOCUMENT_BYTES;
/** Patching the room currently being pruned, once its child rows are gone. */
const PENDING_ROOM_PATCH_BYTES = MAX_DOCUMENT_BYTES + ROOM_SIDE_DOCUMENT_BYTES;
/** Reading one child row, then deleting it (a delete re-reads the document). */
export const CHILD_VISIT_BYTES_READ = 2 * MAX_DOCUMENT_BYTES;

export const MAX_ROOMS_PER_BATCH = Math.floor(BATCH_BYTES_READ_BUDGET / ROOM_VISIT_BYTES_READ);
export const MAX_CHILD_DOCUMENTS_PER_BATCH = 1_000;

export const ROOM_LIFECYCLE_LEASE = "roomLifecycle";
/** A live chain renews its lease every batch, milliseconds apart. */
export const LEASE_TTL_MS = 10 * 60 * 1000;

export const lifecycleBatchResultValidator = v.object({
  outcome: v.union(v.literal("ran"), v.literal("skipped")),
  chainId: v.union(v.string(), v.null()),
  continues: v.boolean(),
  roomsVisited: v.number(),
  expiredRooms: v.number(),
  prunedDocuments: v.number(),
  deletedGuests: v.number(),
  deletedRequests: v.number(),
  bytesRead: v.number(),
  bytesWritten: v.number(),
  documentsRead: v.number(),
  documentsWritten: v.number()
});

export type LifecycleBatchResult = typeof lifecycleBatchResultValidator.type;

type BatchState = {
  now: number;
  roomsVisited: number;
  childDocumentsDeleted: number;
  expiredRooms: number;
  prunedDocuments: number;
  deletedGuests: number;
  deletedRequests: number;
};

type ChildCounter = "prunedDocuments" | "deletedGuests" | "deletedRequests";

async function hasHeadroom(ctx: MutationCtx, bytesRead: number, bytesWritten: number) {
  const metrics = await ctx.meta.getTransactionMetrics();
  return (
    metrics.bytesRead.used + bytesRead <= BATCH_BYTES_READ_BUDGET &&
    metrics.bytesWritten.used + bytesWritten <= BATCH_BYTES_WRITTEN_BUDGET
  );
}

async function canVisitRoom(ctx: MutationCtx, state: BatchState) {
  return (
    state.roomsVisited < MAX_ROOMS_PER_BATCH &&
    (await hasHeadroom(ctx, ROOM_VISIT_BYTES_READ, ROOM_VISIT_BYTES_WRITTEN))
  );
}

async function canVisitChild(ctx: MutationCtx, state: BatchState) {
  return (
    state.childDocumentsDeleted < MAX_CHILD_DOCUMENTS_PER_BATCH &&
    (await hasHeadroom(ctx, CHILD_VISIT_BYTES_READ + PENDING_ROOM_PATCH_BYTES, PENDING_ROOM_PATCH_BYTES))
  );
}

/**
 * Claims or renews the lease. Returns the chain token allowed to run, or null
 * when another chain owns the lease (or this continuation's chain lost it).
 */
async function claimLease(ctx: MutationCtx, chainId: string | undefined, now: number) {
  const lease = await ctx.db
    .query("maintenanceLeases")
    .withIndex("by_name", (index) => index.eq("name", ROOM_LIFECYCLE_LEASE))
    .unique();
  if (chainId !== undefined) {
    if (!lease || lease.token !== chainId) return null;
    await ctx.db.patch("maintenanceLeases", lease._id, { renewedAt: now });
    return chainId;
  }
  if (lease && now - lease.renewedAt < LEASE_TTL_MS) return null;
  const token = crypto.randomUUID();
  if (lease) {
    await ctx.db.patch("maintenanceLeases", lease._id, { token, renewedAt: now });
  } else {
    await ctx.db.insert("maintenanceLeases", { name: ROOM_LIFECYCLE_LEASE, token, renewedAt: now });
  }
  return token;
}

async function releaseLease(ctx: MutationCtx, token: string) {
  const lease = await ctx.db
    .query("maintenanceLeases")
    .withIndex("by_name", (index) => index.eq("name", ROOM_LIFECYCLE_LEASE))
    .unique();
  if (lease?.token === token) await ctx.db.delete("maintenanceLeases", lease._id);
}

/**
 * Visits rooms from `next` until it runs dry (returns true) or the batch must
 * stop: no budget for another room, or a room could not be finished.
 */
async function drainRooms(
  ctx: MutationCtx,
  state: BatchState,
  next: () => Promise<Doc<"rooms"> | null>,
  visit: (room: Doc<"rooms">) => Promise<boolean>
): Promise<boolean> {
  for (;;) {
    if (!(await canVisitRoom(ctx, state))) return false;
    const room = await next();
    if (!room) return true;
    state.roomsVisited += 1;
    // Every finished visit moves the room out of `next`'s index range.
    if (!(await visit(room))) return false;
  }
}

/** Deletes rows one at a time while budget remains. Returns true once drained. */
async function deleteRows<Table extends TableNames>(
  ctx: MutationCtx,
  state: BatchState,
  table: Table,
  rows: AsyncIterable<{ _id: Id<Table> }>,
  counter: ChildCounter
): Promise<boolean> {
  if (!(await canVisitChild(ctx, state))) return false;
  for await (const row of rows) {
    await ctx.db.delete(table, row._id);
    state.childDocumentsDeleted += 1;
    state[counter] += 1;
    // Stop before the next row is read if it might not fit.
    if (!(await canVisitChild(ctx, state))) return false;
  }
  return true;
}

async function expireRoom(ctx: MutationCtx, state: BatchState, room: Doc<"rooms">) {
  const { now } = state;
  const releasesSlot = room.countedActive === true;
  // One patch, so the (possibly large) room document is written once.
  await ctx.db.patch("rooms", room._id, {
    status: "expired",
    endedAt: now,
    lastActivityAt: now,
    ...(releasesSlot ? { countedActive: false } : {})
  });
  if (releasesSlot) await decrementActiveRoomCounter(ctx);
  if (room.hostProfileId) {
    await syncFriendRoomListing(ctx, { ...room, status: "expired" });
    await clearLegacyActiveRoom(ctx, room, now);
  }
  state.expiredRooms += 1;
  return true;
}

async function pruneDetails(ctx: MutationCtx, state: BatchState, roomId: Id<"rooms">) {
  return (
    (await deleteRows(
      ctx,
      state,
      "processedActions",
      ctx.db
        .query("processedActions")
        .withIndex("by_room_id_and_client_action_id", (index) => index.eq("roomId", roomId)),
      "prunedDocuments"
    )) &&
    (await deleteRows(
      ctx,
      state,
      "roomAuditEvents",
      ctx.db
        .query("roomAuditEvents")
        .withIndex("by_room_id_and_created_at", (index) => index.eq("roomId", roomId)),
      "prunedDocuments"
    )) &&
    (await deleteRows(
      ctx,
      state,
      "roomNotificationCursors",
      ctx.db
        .query("roomNotificationCursors")
        .withIndex("by_room_id_and_recipient_key", (index) => index.eq("roomId", roomId)),
      "prunedDocuments"
    ))
  );
}

async function pruneGuestRecords(ctx: MutationCtx, state: BatchState, roomId: Id<"rooms">) {
  return (
    (await deleteRows(
      ctx,
      state,
      "roomGuestRequests",
      ctx.db
        .query("roomGuestRequests")
        .withIndex("by_room_id_and_status", (index) => index.eq("roomId", roomId)),
      "deletedRequests"
    )) &&
    // The index range excludes good-standing guests (revokedAt undefined sorts
    // before every number), so they are never read or touched.
    (await deleteRows(
      ctx,
      state,
      "roomGuests",
      ctx.db
        .query("roomGuests")
        .withIndex("by_room_id_and_revoked_at", (index) =>
          index.eq("roomId", roomId).gte("revokedAt", 0)
        ),
      "deletedGuests"
    ))
  );
}

/** Prunes an old ended/expired room; returns true once both markers are set. */
async function pruneOldRoom(ctx: MutationCtx, state: BatchState, room: Doc<"rooms">) {
  const detailsDone =
    room.detailsPrunedAt !== undefined || (await pruneDetails(ctx, state, room._id));
  const guestsDone =
    detailsDone &&
    (room.guestRecordsPrunedAt !== undefined || (await pruneGuestRecords(ctx, state, room._id)));
  const markers = {
    ...(detailsDone && room.detailsPrunedAt === undefined ? { detailsPrunedAt: state.now } : {}),
    ...(guestsDone && room.guestRecordsPrunedAt === undefined
      ? { guestRecordsPrunedAt: state.now }
      : {})
  };
  if (Object.keys(markers).length > 0) await ctx.db.patch("rooms", room._id, markers);
  return detailsDone && guestsDone;
}

async function runPhases(ctx: MutationCtx, state: BatchState): Promise<boolean> {
  const { now } = state;
  const idleBefore = now - ACTIVE_ROOM_IDLE_MS;
  const retainedAfter = now - ENDED_DETAIL_RETENTION_MS;

  // Rooms are selected one at a time with `.first()`, so no room is loaded
  // unless the budget already covers visiting it.
  const drainedIdle = await drainRooms(
    ctx,
    state,
    () =>
      ctx.db
        .query("rooms")
        .withIndex("by_status_and_last_activity_at", (index) =>
          index.eq("status", "active").lt("lastActivityAt", idleBefore)
        )
        .first(),
    (room) => expireRoom(ctx, state, room)
  );
  if (!drainedIdle) return false;

  for (const status of ["ended", "expired"] as const) {
    const drained = await drainRooms(
      ctx,
      state,
      () =>
        ctx.db
          .query("rooms")
          .withIndex("by_status_and_details_pruned_at_and_last_activity_at", (index) =>
            index
              .eq("status", status)
              .eq("detailsPrunedAt", undefined)
              .lt("lastActivityAt", retainedAfter)
          )
          .first(),
      (room) => pruneOldRoom(ctx, state, room)
    );
    if (!drained) return false;
  }

  // Rooms whose details were pruned before guest-record cleanup existed.
  for (const status of ["ended", "expired"] as const) {
    const drained = await drainRooms(
      ctx,
      state,
      () =>
        ctx.db
          .query("rooms")
          .withIndex("by_status_and_guest_records_pruned_at_and_last_activity_at", (index) =>
            index
              .eq("status", status)
              .eq("guestRecordsPrunedAt", undefined)
              .lt("lastActivityAt", retainedAfter)
          )
          .first(),
      (room) => pruneOldRoom(ctx, state, room)
    );
    if (!drained) return false;
  }
  return true;
}

/**
 * Runs one budgeted batch. `chainId` is undefined for a fresh start (cron or
 * legacy continuation) and the chain token for a continuation. The caller
 * schedules the continuation when `continues` is true.
 */
export async function runLifecycleBatch(
  ctx: MutationCtx,
  chainId: string | undefined
): Promise<LifecycleBatchResult> {
  const state: BatchState = {
    now: Date.now(),
    roomsVisited: 0,
    childDocumentsDeleted: 0,
    expiredRooms: 0,
    prunedDocuments: 0,
    deletedGuests: 0,
    deletedRequests: 0
  };
  const token = await claimLease(ctx, chainId, state.now);
  let continues = false;
  if (token !== null) {
    continues = !(await runPhases(ctx, state));
    if (!continues) await releaseLease(ctx, token);
  }
  const metrics = await ctx.meta.getTransactionMetrics();
  return {
    outcome: token === null ? "skipped" : "ran",
    chainId: token,
    continues,
    roomsVisited: state.roomsVisited,
    expiredRooms: state.expiredRooms,
    prunedDocuments: state.prunedDocuments,
    deletedGuests: state.deletedGuests,
    deletedRequests: state.deletedRequests,
    bytesRead: metrics.bytesRead.used,
    bytesWritten: metrics.bytesWritten.used,
    documentsRead: metrics.documentsRead.used,
    documentsWritten: metrics.documentsWritten.used
  };
}
