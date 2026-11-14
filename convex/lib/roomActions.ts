// Ledger writes to a room: host actions, approving a guest's requested
// transaction, and (via commitRoomAction) any server-authored change.
import type { GameState } from "../../src/domain/pokerTypes";
import {
  applyHostedAction,
  isRebaseableHostedAction,
  MAX_ROOM_ACTIONS
} from "../../src/session/roomProtocol";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { validIdentifier } from "./capabilities";
import { syncFriendRoomListing } from "./friendDiscovery";
import { requireHost } from "./roomAccess";
import { appendAuditEvent, buildAuditEvent } from "./roomAudit";
import { fail } from "./roomErrors";
import { HOST_RECIPIENT_KEY } from "./roomNotifications";
import { publicRoomWithActivity } from "./roomViews";

/**
 * The version the host last wrote. Rooms from before hostBaseVersion existed
 * have only host writes, so their current version is that base.
 */
export function hostBaseVersion(room: Doc<"rooms">): number {
  return room.hostBaseVersion ?? room.version;
}

/**
 * A host write must be based on the current version, or, for an action that
 * is safe to rebase, on any version since the host's own last write: the only
 * changes in between were made by the server, and the action is re-run
 * through the reducer and validation against the latest state.
 */
export function requireHostVersion(
  room: Doc<"rooms">,
  expectedVersion: number,
  rebaseable: boolean
) {
  if (Number.isSafeInteger(expectedVersion)) {
    if (expectedVersion === room.version) return;
    if (
      rebaseable &&
      expectedVersion < room.version &&
      expectedVersion >= hostBaseVersion(room)
    ) {
      return;
    }
  }
  fail("VERSION_CONFLICT", `Room changed; reload version ${room.version}.`);
}

/**
 * Applies one action to the room and records it: the new state and version,
 * a processedActions row for `clientActionId`, and the shared audit event.
 * Callers check access, idempotency, and the expected version first.
 *
 * `hostAuthored` writes move hostBaseVersion to the new version; server-
 * authored ones leave it where it was, so the host's in-flight actions based
 * on the previous version can still be rebased.
 */
export async function commitRoomAction(
  ctx: MutationCtx,
  room: Doc<"rooms">,
  action: unknown,
  options: {
    actorLabel: string;
    clientActionId: string;
    hostAuthored: boolean;
    /** Keep agreement metadata on the action's transactions (server-built only). */
    trustAgreementMetadata?: boolean;
  }
) {
  if (room.acceptedActionCount >= MAX_ROOM_ACTIONS) {
    fail("ROOM_LIMIT_REACHED", "This room has reached its action limit.");
  }

  const now = Date.now();
  const beforeState = room.state as GameState;
  const applied = applyHostedAction(
    beforeState,
    action,
    new Date(now).toISOString(),
    () => `transaction_${crypto.randomUUID()}`,
    { trustAgreementMetadata: options.trustAgreementMetadata === true }
  );
  if ("error" in applied) fail("INVALID_ARGUMENT", applied.error);
  const version = room.version + 1;
  const name = applied.state.settings.gameName.trim().slice(0, 80) || "Poker Night";
  const nextRoom: Doc<"rooms"> = {
    ...room,
    state: applied.state,
    name,
    version,
    hostBaseVersion: options.hostAuthored ? version : hostBaseVersion(room),
    acceptedActionCount: room.acceptedActionCount + 1,
    lastActivityAt: now
  };
  await ctx.db.patch(room._id, {
    state: nextRoom.state,
    name: nextRoom.name,
    version: nextRoom.version,
    hostBaseVersion: nextRoom.hostBaseVersion,
    acceptedActionCount: nextRoom.acceptedActionCount,
    lastActivityAt: now
  });
  if (room.hostProfileId && name !== room.name) {
    await syncFriendRoomListing(ctx, nextRoom);
  }
  await ctx.db.insert("processedActions", {
    roomId: room._id,
    clientActionId: options.clientActionId,
    resultingVersion: version,
    processedAt: now
  });
  const auditEvent = buildAuditEvent(
    beforeState,
    applied.state,
    action,
    version,
    now,
    options.actorLabel
  );
  if (auditEvent) await appendAuditEvent(ctx, room._id, auditEvent);
  return { room: nextRoom, state: applied.state };
}

export async function decideGuestRequest(
  ctx: MutationCtx,
  args: {
    publicId: string;
    hostSecret: string;
    controllerId: string;
    requestId: Id<"roomGuestRequests">;
    decision: "approved" | "rejected";
    expectedVersion: number;
  }
) {
  const room = await requireHost(ctx, args.publicId, args.hostSecret);
  if (room.status !== "active") fail("ROOM_NOT_ACTIVE", "This room is no longer active.");
  if (room.hostControllerId !== args.controllerId) {
    fail("DUPLICATE_CONTROLLER", "Another tab controls this hosted room.");
  }
  const request = await ctx.db.get("roomGuestRequests", args.requestId);
  if (!request || request.roomId !== room._id || request.status !== "pending") {
    fail("INVALID_ARGUMENT", "This guest request is no longer pending.");
  }
  if (args.decision === "rejected") {
    await ctx.db.patch(request._id, { status: "rejected", decidedAt: Date.now() });
    return null;
  }
  const guest = await ctx.db.get("roomGuests", request.guestId);
  if (!guest || guest.revokedAt !== undefined) {
    fail("INVALID_ARGUMENT", "This guest no longer has access to the room.");
  }
  // Approving adds one transaction, so it rebases like a host add_transaction.
  requireHostVersion(room, args.expectedVersion, true);
  const { room: nextRoom } = await commitRoomAction(
    ctx,
    room,
    { type: "add_transaction", transaction: request.transaction },
    {
      actorLabel: "Host-approved guest request",
      clientActionId: `guest_request_${request._id}`,
      hostAuthored: true
    }
  );
  await ctx.db.patch(request._id, { status: "approved", decidedAt: nextRoom.lastActivityAt });
  return null;
}

export async function applyHostAction(
  ctx: MutationCtx,
  args: {
    publicId: string;
    hostSecret: string;
    controllerId: string;
    expectedVersion: number;
    clientActionId: string;
    action: any;
  }
) {
  const room = await requireHost(ctx, args.publicId, args.hostSecret);
  if (room.status !== "active") fail("ROOM_NOT_ACTIVE", "This room is no longer active.");
  if (room.hostControllerId !== args.controllerId) {
    fail("DUPLICATE_CONTROLLER", "Another tab controls this hosted room.");
  }
  if (!validIdentifier(args.clientActionId)) {
    fail("INVALID_ARGUMENT", "Client action identity is invalid.");
  }

  const processed = await ctx.db
    .query("processedActions")
    .withIndex("by_room_id_and_client_action_id", (index) =>
      index.eq("roomId", room._id).eq("clientActionId", args.clientActionId)
    )
    .unique();
  if (processed) {
    return {
      ...(await publicRoomWithActivity(ctx, room, room.state as GameState, HOST_RECIPIENT_KEY)),
      duplicate: true,
      resultingVersion: processed.resultingVersion
    };
  }
  requireHostVersion(room, args.expectedVersion, isRebaseableHostedAction(args.action));

  const { room: nextRoom, state } = await commitRoomAction(ctx, room, args.action, {
    actorLabel: "Host",
    clientActionId: args.clientActionId,
    hostAuthored: true
  });
  return {
    ...(await publicRoomWithActivity(ctx, nextRoom, state, HOST_RECIPIENT_KEY)),
    duplicate: false,
    resultingVersion: nextRoom.version
  };
}
