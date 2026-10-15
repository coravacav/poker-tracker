// @vitest-environment edge-runtime
/// <reference types="vite/client" />

import presenceTest from "@convex-dev/presence/test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_ROOM_SNAPSHOT_BYTES } from "../src/session/roomProtocol";
import { createDefaultGameState } from "../src/state/seedGame";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  BATCH_BYTES_READ_BUDGET,
  BATCH_BYTES_WRITTEN_BUDGET,
  CHILD_VISIT_BYTES_READ,
  CONVEX_TRANSACTION_LIMITS,
  LEASE_TTL_MS,
  type LifecycleBatchResult,
  MAX_CHILD_DOCUMENTS_PER_BATCH,
  MAX_DOCUMENT_BYTES,
  MAX_ROOMS_PER_BATCH,
  ROOM_SIDE_DOCUMENT_BYTES,
  ROOM_VISIT_BYTES_READ,
  ROOM_VISIT_BYTES_WRITTEN
} from "./lib/roomLifecycle";
import schema from "./schema";

const modules = import.meta.glob("./**/!(*.*.*)*.*s");
const DAY = 24 * 60 * 60 * 1000;
// Near the 1 MiB document cap, beyond the 700 KB snapshot limit.
const PADDING = "x".repeat(1_000_000);

type TestConvex = ReturnType<typeof setup>;

function setup() {
  // Enforce the real Convex per-transaction limits.
  const test = convexTest({ schema, modules, transactionLimits: true });
  presenceTest.register(test);
  rateLimiterTest.register(test);
  return test;
}

let sequence = 0;

/** Inserts one room (and optionally its children) per transaction. */
async function seedRoom(
  test: TestConvex,
  options: {
    status: "active" | "ended" | "expired";
    ageDays: number;
    large?: boolean;
    countedActive?: boolean;
    hostProfileId?: Id<"friendProfiles">;
    processedActions?: number;
    auditEvents?: number;
    revokedGuests?: number;
    requests?: number;
  }
) {
  sequence += 1;
  const suffix = `${sequence}`.padStart(6, "0");
  return await test.run(async (ctx) => {
    const snapshot = createDefaultGameState();
    const at = Date.now() - options.ageDays * DAY;
    const roomId = await ctx.db.insert("rooms", {
      publicId: `room_cycle_${suffix}_abcdef`,
      status: options.status,
      name: "Seeded",
      localGameId: snapshot.localGameId,
      state: options.large ? { ...snapshot, padding: PADDING } : snapshot,
      version: 0,
      acceptedActionCount: 0,
      createdAt: at,
      lastActivityAt: at,
      ...(options.status === "active" ? {} : { endedAt: at }),
      hostSecretHash: `host_${suffix}`,
      inviteSecretHash: `invite_${suffix}`,
      hostControllerId: "controller_abcdefghijklmnop",
      ...(options.countedActive ? { countedActive: true } : {}),
      ...(options.hostProfileId
        ? { hostProfileId: options.hostProfileId, visibleToFriends: true }
        : {})
    });
    if (options.hostProfileId) {
      await ctx.db.insert("friendRoomListings", {
        hostProfileId: options.hostProfileId,
        roomId,
        publicId: `room_cycle_${suffix}_abcdef`,
        name: "Seeded",
        roomCreatedAt: at
      });
    }
    for (let index = 0; index < (options.processedActions ?? 2); index += 1) {
      await ctx.db.insert("processedActions", {
        roomId,
        clientActionId: `action_${suffix}_${index}`,
        resultingVersion: index,
        processedAt: at
      });
    }
    for (let index = 0; index < (options.auditEvents ?? 2); index += 1) {
      await ctx.db.insert("roomAuditEvents", {
        roomId,
        eventId: `event_${suffix}_${index}`,
        version: index,
        actionType: "add_transaction",
        kind: "transaction",
        summary: "Seeded",
        transactionIds: [],
        playerIds: [],
        actorLabel: "Host",
        createdAt: at,
        notify: true
      });
    }
    await ctx.db.insert("roomNotificationCursors", {
      roomId,
      recipientKey: "host",
      lastReadVersion: 0,
      updatedAt: at
    });
    const goodGuestId = await ctx.db.insert("roomGuests", {
      roomId,
      displayName: "Good guest",
      guestSecretHash: `good_${suffix}`,
      joinedAt: at
    });
    for (let index = 0; index < (options.revokedGuests ?? 1); index += 1) {
      await ctx.db.insert("roomGuests", {
        roomId,
        displayName: `Revoked ${index}`,
        guestSecretHash: `revoked_${suffix}_${index}`,
        joinedAt: at,
        revokedAt: at
      });
    }
    for (let index = 0; index < (options.requests ?? 2); index += 1) {
      await ctx.db.insert("roomGuestRequests", {
        roomId,
        guestId: goodGuestId,
        transaction: {},
        status: "approved",
        createdAt: at,
        decidedAt: at
      });
    }
    return roomId;
  });
}

async function seedProfile(test: TestConvex) {
  return await test.run(async (ctx) =>
    await ctx.db.insert("friendProfiles", {
      friendCode: "ABCDEFGHJKMNPQRSTVWXYZ23",
      displayName: "Host",
      ownerSecretHash: "owner_hash",
      createdAt: Date.now(),
      updatedAt: Date.now()
    })
  );
}

async function setActiveCounter(test: TestConvex, value: number) {
  await test.run(async (ctx) => {
    await ctx.db.insert("roomCounters", { name: "activeRooms", value });
  });
}

async function snapshotState(test: TestConvex, roomIds: Id<"rooms">[]) {
  const rooms = [];
  // One transaction per room: several near-1 MiB rooms exceed the read limit.
  for (const roomId of roomIds) {
    rooms.push(await test.run(async (ctx) => {
      const room = await ctx.db.get("rooms", roomId);
      const count = async (rows: Promise<unknown[]>) => (await rows).length;
      return {
        status: room!.status,
        countedActive: room!.countedActive,
        detailsPrunedAt: room!.detailsPrunedAt,
        guestRecordsPrunedAt: room!.guestRecordsPrunedAt,
        // State is kept for history views.
        hasState: room!.state !== undefined,
        processedActions: await count(ctx.db
          .query("processedActions")
          .withIndex("by_room_id_and_client_action_id", (index) => index.eq("roomId", roomId))
          .collect()),
        auditEvents: await count(ctx.db
          .query("roomAuditEvents")
          .withIndex("by_room_id_and_created_at", (index) => index.eq("roomId", roomId))
          .collect()),
        cursors: await count(ctx.db
          .query("roomNotificationCursors")
          .withIndex("by_room_id_and_recipient_key", (index) => index.eq("roomId", roomId))
          .collect()),
        guests: (await ctx.db
          .query("roomGuests")
          .withIndex("by_room_id", (index) => index.eq("roomId", roomId))
          .collect()).map((guest) => guest.revokedAt === undefined ? "good" : "revoked"),
        requests: await count(ctx.db
          .query("roomGuestRequests")
          .withIndex("by_room_id_and_status", (index) => index.eq("roomId", roomId))
          .collect())
      };
    }));
  }
  return await test.run(async (ctx) => {
    const counter = await ctx.db
      .query("roomCounters")
      .withIndex("by_name", (index) => index.eq("name", "activeRooms"))
      .unique();
    const listings = await ctx.db.query("friendRoomListings").collect();
    const leases = await ctx.db.query("maintenanceLeases").collect();
    return { rooms, activeRooms: counter?.value, listings: listings.length, leases: leases.length };
  });
}

async function pendingLifecycleRuns(test: TestConvex) {
  return await test.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").collect()).filter(
      (job) => job.state.kind === "pending" && job.name.includes("runRoomLifecycle")
    ).length
  );
}

/** Drives one chain batch by batch, the way its scheduled continuations would. */
async function drainChain(test: TestConvex) {
  const results: LifecycleBatchResult[] = [
    await test.mutation(internal.rooms.runRoomLifecycle, {})
  ];
  while (results[results.length - 1]!.continues) {
    expect(results.length).toBeLessThan(200);
    results.push(await test.mutation(internal.rooms.runRoomLifecycle, {
      continuation: true,
      chainId: results[0]!.chainId!
    }));
  }
  return results;
}

function expectWithinBudget(result: LifecycleBatchResult) {
  expect(result.roomsVisited).toBeLessThanOrEqual(MAX_ROOMS_PER_BATCH);
  expect(result.bytesRead).toBeLessThanOrEqual(BATCH_BYTES_READ_BUDGET);
  expect(result.bytesWritten).toBeLessThanOrEqual(BATCH_BYTES_WRITTEN_BUDGET);
  expect(result.prunedDocuments + result.deletedGuests + result.deletedRequests)
    .toBeLessThanOrEqual(MAX_CHILD_DOCUMENTS_PER_BATCH);
  expect(result.documentsWritten).toBeLessThan(CONVEX_TRANSACTION_LIMITS.documentsWritten / 10);
  expect(result.documentsRead).toBeLessThan(CONVEX_TRANSACTION_LIMITS.documentsRead / 10);
}

describe("room lifecycle batch budget", () => {
  it("sizes batches from the document cap with room to spare", () => {
    // Every room document fits the Convex document cap, which is above the
    // snapshot limit, so charging the cap covers any snapshot encoding.
    expect(MAX_DOCUMENT_BYTES).toBe(1024 * 1024);
    expect(MAX_DOCUMENT_BYTES).toBeGreaterThan(MAX_ROOM_SNAPSHOT_BYTES);
    // Select + patch reads the room twice and writes it once.
    expect(ROOM_VISIT_BYTES_READ).toBe(2 * MAX_DOCUMENT_BYTES + ROOM_SIDE_DOCUMENT_BYTES);
    expect(ROOM_VISIT_BYTES_WRITTEN).toBe(MAX_DOCUMENT_BYTES + ROOM_SIDE_DOCUMENT_BYTES);
    // 8 MiB / (2 MiB + 64 KiB) = 3.88 -> three rooms per batch.
    expect(BATCH_BYTES_READ_BUDGET).toBe(CONVEX_TRANSACTION_LIMITS.bytesRead / 2);
    expect(BATCH_BYTES_WRITTEN_BUDGET).toBe(CONVEX_TRANSACTION_LIMITS.bytesWritten / 2);
    expect(MAX_ROOMS_PER_BATCH).toBe(3);
    expect(MAX_ROOMS_PER_BATCH * ROOM_VISIT_BYTES_READ).toBeLessThanOrEqual(BATCH_BYTES_READ_BUDGET);
    expect(MAX_ROOMS_PER_BATCH * ROOM_VISIT_BYTES_WRITTEN).toBeLessThanOrEqual(BATCH_BYTES_WRITTEN_BUDGET);
    // The old design read up to 30 rooms per transaction: far over 16 MiB.
    expect(30 * MAX_ROOM_SNAPSHOT_BYTES).toBeGreaterThan(CONVEX_TRANSACTION_LIMITS.bytesRead);
    // A child row costs at most a read plus a delete re-read of one document.
    expect(CHILD_VISIT_BYTES_READ).toBe(2 * MAX_DOCUMENT_BYTES);
    // Child deletions plus room work stay well inside the document limits.
    const documentsPerBatch = MAX_CHILD_DOCUMENTS_PER_BATCH + MAX_ROOMS_PER_BATCH * 6 + 2;
    expect(documentsPerBatch * 2).toBeLessThan(CONVEX_TRANSACTION_LIMITS.documentsRead / 10);
    expect(documentsPerBatch).toBeLessThan(CONVEX_TRANSACTION_LIMITS.documentsWritten / 10);
  });
});

describe("room lifecycle chain", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("drains a backlog of near-1 MiB rooms in batches that stay under budget", async () => {
    const test = setup();
    const profileId = await seedProfile(test);
    const staleActive: Id<"rooms">[] = [];
    for (let index = 0; index < 7; index += 1) {
      staleActive.push(await seedRoom(test, {
        status: "active",
        ageDays: 8,
        large: true,
        countedActive: true,
        ...(index % 2 === 0 ? { hostProfileId: profileId } : {})
      }));
    }
    await setActiveCounter(test, staleActive.length + 1);
    await test.run(async (ctx) => {
      // Legacy single-room pointer is cleared when its room expires.
      await ctx.db.patch("friendProfiles", profileId, { activeRoomId: staleActive[0] });
    });
    const freshActive = await seedRoom(test, {
      status: "active",
      ageDays: 1,
      large: true,
      countedActive: true,
      hostProfileId: profileId
    });
    const oldRooms: Id<"rooms">[] = [];
    for (let index = 0; index < 8; index += 1) {
      oldRooms.push(await seedRoom(test, {
        status: index % 2 === 0 ? "ended" : "expired",
        ageDays: 31 + index,
        large: true
      }));
    }
    const recentEnded = await seedRoom(test, { status: "ended", ageDays: 20, large: true });

    const results = await drainChain(test);

    for (const result of results) expectWithinBudget(result);
    // The rooms really are large: a full batch reads several MiB.
    expect(Math.max(...results.map((result) => result.bytesRead))).toBeGreaterThan(4 * MAX_DOCUMENT_BYTES);
    expect(results.length).toBeGreaterThanOrEqual(Math.ceil(15 / MAX_ROOMS_PER_BATCH));
    expect(new Set(results.map((result) => result.chainId)).size).toBe(1);
    expect(results.reduce((sum, result) => sum + result.expiredRooms, 0)).toBe(7);

    const state = await snapshotState(test, [...staleActive, freshActive, ...oldRooms, recentEnded]);
    for (const room of state.rooms.slice(0, 7)) {
      expect(room).toMatchObject({ status: "expired", countedActive: false, hasState: true });
      // Expired today: details are retained for another 30 days.
      expect(room.processedActions).toBe(2);
      expect(room.detailsPrunedAt).toBeUndefined();
    }
    expect(state.rooms[7]).toMatchObject({ status: "active", countedActive: true });
    expect(state.activeRooms).toBe(1);
    expect(state.listings).toBe(1);
    for (const room of state.rooms.slice(8, 16)) {
      expect(room).toEqual({
        status: expect.any(String),
        countedActive: undefined,
        detailsPrunedAt: expect.any(Number),
        guestRecordsPrunedAt: expect.any(Number),
        hasState: true,
        processedActions: 0,
        auditEvents: 0,
        cursors: 0,
        guests: ["good"],
        requests: 0
      });
    }
    expect(state.rooms[16]!.detailsPrunedAt).toBeUndefined();
    expect(state.rooms[16]!.processedActions).toBe(2);
    // The chain released its lease, so the next daily run starts a fresh chain.
    expect(state.leases).toBe(0);
    const profile = await test.run(async (ctx) => await ctx.db.get("friendProfiles", profileId));
    expect(profile?.activeRoomId).toBeUndefined();

    // Continuations scheduled along the way are now stale and do nothing.
    await test.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await snapshotState(test, [...staleActive, freshActive, ...oldRooms, recentEnded]))
      .toEqual(state);
  });

  it("splits a room with many detail rows across batches", async () => {
    const test = setup();
    const heavy = await seedRoom(test, {
      status: "ended",
      ageDays: 40,
      large: true,
      processedActions: 2_400,
      auditEvents: 300,
      revokedGuests: 60,
      requests: 70
    });

    const results = await drainChain(test);
    for (const result of results) expectWithinBudget(result);
    expect(results[0]!.prunedDocuments).toBe(MAX_CHILD_DOCUMENTS_PER_BATCH);
    expect(results.length).toBeGreaterThanOrEqual(3);
    const deleted = results.reduce(
      (sum, result) => sum + result.prunedDocuments + result.deletedGuests + result.deletedRequests,
      0
    );
    expect(deleted).toBe(2_400 + 300 + 1 + 60 + 70);
    const [room] = (await snapshotState(test, [heavy])).rooms;
    expect(room).toMatchObject({
      detailsPrunedAt: expect.any(Number),
      guestRecordsPrunedAt: expect.any(Number),
      processedActions: 0,
      auditEvents: 0,
      cursors: 0,
      guests: ["good"],
      requests: 0
    });
  });

  it("drains the backlog through scheduled continuations", async () => {
    const test = setup();
    const roomIds: Id<"rooms">[] = [];
    for (let index = 0; index < 10; index += 1) {
      roomIds.push(await seedRoom(test, { status: "active", ageDays: 9, large: index < 4 }));
    }
    const first = await test.mutation(internal.rooms.runRoomLifecycle, {});
    expect(first).toMatchObject({ outcome: "ran", continues: true, expiredRooms: MAX_ROOMS_PER_BATCH });
    await test.finishAllScheduledFunctions(vi.runAllTimers);
    const state = await snapshotState(test, roomIds);
    expect(state.rooms.every((room) => room.status === "expired")).toBe(true);
    expect(state.leases).toBe(0);
  });

  it("runs a single chain when the cron fires while a chain is live", async () => {
    const test = setup();
    const roomIds: Id<"rooms">[] = [];
    for (let index = 0; index < 10; index += 1) {
      roomIds.push(await seedRoom(test, { status: "active", ageDays: 9, countedActive: true }));
    }
    await setActiveCounter(test, roomIds.length);

    const first = await test.mutation(internal.rooms.runRoomLifecycle, {});
    expect(first).toMatchObject({ outcome: "ran", continues: true });
    expect(await pendingLifecycleRuns(test)).toBe(1);

    // A second cron run, a pre-chain continuation, and the deprecated guest
    // cleanup entry point all defer to the live chain.
    for (const duplicate of [
      test.mutation(internal.rooms.runRoomLifecycle, {}),
      test.mutation(internal.rooms.runRoomLifecycle, { continuation: true }),
      test.mutation(internal.rooms.pruneOldGuestRecords, {})
    ]) {
      expect(await duplicate).toMatchObject({ outcome: "skipped", chainId: null, roomsVisited: 0 });
    }
    // A forged or stale chain token does nothing either.
    expect(await test.mutation(internal.rooms.runRoomLifecycle, {
      continuation: true,
      chainId: "not-the-live-chain"
    })).toMatchObject({ outcome: "skipped", roomsVisited: 0 });
    expect(await pendingLifecycleRuns(test)).toBe(1);

    // A chain that stops renewing its lease (e.g. a failed batch) is taken
    // over by the next start; the old chain's continuation then stops.
    vi.setSystemTime(Date.now() + LEASE_TTL_MS + 1);
    const takeover = await test.mutation(internal.rooms.runRoomLifecycle, {});
    expect(takeover).toMatchObject({ outcome: "ran" });
    expect(takeover.chainId).not.toBe(first.chainId);
    expect(await test.mutation(internal.rooms.runRoomLifecycle, {
      continuation: true,
      chainId: first.chainId!
    })).toMatchObject({ outcome: "skipped" });

    await test.finishAllScheduledFunctions(vi.runAllTimers);
    const state = await snapshotState(test, roomIds);
    expect(state.rooms.every((room) => room.status === "expired")).toBe(true);
    // Each slot was released exactly once.
    expect(state.activeRooms).toBe(0);
    expect(state.leases).toBe(0);
    expect(await pendingLifecycleRuns(test)).toBe(0);
  });
});
