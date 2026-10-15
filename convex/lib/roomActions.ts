// Host-applied ledger actions, including approving a guest's requested transaction.
import type { GameState } from "../../src/domain/pokerTypes";
import { applyHostedAction, MAX_ROOM_ACTIONS } from "../../src/session/roomProtocol";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { validIdentifier } from "./capabilities";
import { syncFriendRoomListing } from "./friendDiscovery";
import { requireHost } from "./roomAccess";
import { appendAuditEvent, buildAuditEvent } from "./roomAudit";
import { fail } from "./roomErrors";
import { HOST_RECIPIENT_KEY } from "./roomNotifications";
import { publicRoomWithActivity } from "./roomViews";

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
  if (args.expectedVersion !== room.version) {
    fail("VERSION_CONFLICT", `Room changed; reload version ${room.version}.`);
  }
  const now = Date.now();
  const action = { type: "add_transaction", transaction: request.transaction };
  const applied = applyHostedAction(
    room.state as GameState,
    action,
    new Date(now).toISOString(),
    () => `transaction_${crypto.randomUUID()}`
  );
  if ("error" in applied) fail("INVALID_ARGUMENT", applied.error);
  const version = room.version + 1;
  const auditEvent = buildAuditEvent(room.state as GameState, applied.state, action, version, now);
  await ctx.db.patch(room._id, {
    state: applied.state,
    version,
    acceptedActionCount: room.acceptedActionCount + 1,
    lastActivityAt: now
  });
  await ctx.db.patch(request._id, { status: "approved", decidedAt: now });
  if (auditEvent) {
    await appendAuditEvent(ctx, room._id, {
      ...auditEvent,
      actorLabel: "Host-approved guest request"
    });
  }
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
  if (!Number.isSafeInteger(args.expectedVersion) || args.expectedVersion !== room.version) {
    fail("VERSION_CONFLICT", `Room changed; reload version ${room.version}.`);
  }
  if (room.acceptedActionCount >= MAX_ROOM_ACTIONS) {
    fail("ROOM_LIMIT_REACHED", "This room has reached its action limit.");
  }

  const now = Date.now();
  const beforeState = room.state as GameState;
  const applied = applyHostedAction(
    beforeState,
    args.action,
    new Date(now).toISOString(),
    () => `transaction_${crypto.randomUUID()}`
  );
  if ("error" in applied) fail("INVALID_ARGUMENT", applied.error);
  const version = room.version + 1;
  const auditEvent = buildAuditEvent(beforeState, applied.state, args.action, version, now);
  const name = applied.state.settings.gameName.trim().slice(0, 80) || "Poker Night";
  await ctx.db.patch(room._id, {
    state: applied.state,
    name,
    version,
    acceptedActionCount: room.acceptedActionCount + 1,
    lastActivityAt: now
  });
  if (room.hostProfileId && name !== room.name) {
    await syncFriendRoomListing(ctx, { ...room, name });
  }
  await ctx.db.insert("processedActions", {
    roomId: room._id,
    clientActionId: args.clientActionId,
    resultingVersion: version,
    processedAt: now
  });
  if (auditEvent) await appendAuditEvent(ctx, room._id, auditEvent);
  return {
    ...(await publicRoomWithActivity(
      ctx,
      { ...room, version, name },
      applied.state,
      HOST_RECIPIENT_KEY
    )),
    duplicate: false,
    resultingVersion: version
  };
}
