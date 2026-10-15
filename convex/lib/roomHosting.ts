// Host room lifecycle: create, claim the controller, friend visibility, and end.
import type { GameState } from "../../src/domain/pokerTypes";
import {
  CREATION_LIMITED_CODE,
  ROOM_CREATION_LIMITED_MESSAGE
} from "../../src/session/creationLimits";
import { normalizeGameState, roomStateError } from "../../src/session/roomProtocol";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { hashSecret, validIdentifier, validSecret } from "./capabilities";
import {
  creationLimiter,
  releaseActiveRoomSlot,
  reserveActiveRoomSlot
} from "./creationLimits";
import {
  clearLegacyActiveRoom,
  syncFriendRoomListing,
  verifyProfileOwner
} from "./friendDiscovery";
import { requireHost, roomByPublicId } from "./roomAccess";
import { appendAuditEvent } from "./roomAudit";
import { fail } from "./roomErrors";
import { HOST_RECIPIENT_KEY } from "./roomNotifications";
import { publicRoomWithActivity } from "./roomViews";

export async function createRoom(
  ctx: MutationCtx,
  args: {
    publicId: string;
    localGameId: string;
    snapshot: any;
    hostSecret: string;
    inviteSecret: string;
    controllerId: string;
    friendCode?: string;
    profileOwnerSecret?: string;
    visibleToFriends?: boolean;
  }
) {
  if (
    !validIdentifier(args.publicId) ||
    !validIdentifier(args.localGameId) ||
    !validIdentifier(args.controllerId) ||
    !validSecret(args.hostSecret) ||
    !validSecret(args.inviteSecret) ||
    args.hostSecret === args.inviteSecret
  ) {
    fail("INVALID_ARGUMENT", "Room identifiers or capabilities are invalid.");
  }

  const stateError = roomStateError(args.snapshot);
  if (stateError) fail("INVALID_ARGUMENT", stateError);
  const snapshot = normalizeGameState(args.snapshot as GameState);
  if (snapshot.localGameId !== args.localGameId) {
    fail("INVALID_ARGUMENT", "Local game identity does not match the snapshot.");
  }
  const name = snapshot.settings.gameName.trim().slice(0, 80) || "Poker Night";

  const existingPublicRoom = await roomByPublicId(ctx, args.publicId);
  if (existingPublicRoom) fail("INVALID_ARGUMENT", "Room identifier is already in use.");
  const existingLocalRoom = await ctx.db
    .query("rooms")
    .withIndex("by_local_game_id_and_status", (index) =>
      index.eq("localGameId", args.localGameId).eq("status", "active")
    )
    .first();
  if (existingLocalRoom) {
    fail("ROOM_LIMIT_REACHED", "This local game already has an active shared room.");
  }

  let hostProfile: Doc<"friendProfiles"> | null = null;
  if ((args.friendCode === undefined) !== (args.profileOwnerSecret === undefined)) {
    fail("INVALID_ARGUMENT", "Friend code and profile owner secret must be provided together.");
  }
  if (args.friendCode !== undefined && args.profileOwnerSecret !== undefined) {
    const check = await verifyProfileOwner(ctx, args.friendCode, args.profileOwnerSecret);
    if (!check.ok) {
      if (check.reason === "invalid_argument") {
        fail("INVALID_ARGUMENT", "Friend profile capability is invalid.");
      }
      fail("INVALID_CAPABILITY", "Friend profile capability is invalid.");
    }
    hostProfile = check.profile;
  }

  // Creation limits run last so that invalid requests are rejected with
  // their specific error. A failure anywhere in this mutation rolls back
  // the consumed tokens and the reserved slot.
  const globalLimit = await creationLimiter.limit(ctx, "roomCreation");
  if (!globalLimit.ok) fail(CREATION_LIMITED_CODE, ROOM_CREATION_LIMITED_MESSAGE);
  if (hostProfile) {
    const profileLimit = await creationLimiter.limit(ctx, "profileRoomCreation", {
      key: hostProfile._id
    });
    if (!profileLimit.ok) fail(CREATION_LIMITED_CODE, ROOM_CREATION_LIMITED_MESSAGE);
  }
  if (!(await reserveActiveRoomSlot(ctx))) {
    fail(CREATION_LIMITED_CODE, ROOM_CREATION_LIMITED_MESSAGE);
  }

  const now = Date.now();
  const roomId = await ctx.db.insert("rooms", {
    publicId: args.publicId,
    status: "active",
    name,
    localGameId: args.localGameId,
    state: snapshot,
    version: 0,
    acceptedActionCount: 0,
    createdAt: now,
    lastActivityAt: now,
    hostSecretHash: await hashSecret(args.hostSecret),
    inviteSecretHash: await hashSecret(args.inviteSecret),
    joiningOpen: true,
    hostControllerId: args.controllerId,
    countedActive: true,
    ...(hostProfile ? {
      hostProfileId: hostProfile._id,
      visibleToFriends: args.visibleToFriends ?? true
    } : {})
  });
  if (hostProfile) {
    // Each linked room gets its own listing, so hosting a second room no
    // longer hides the first from followers.
    const createdRoom = await ctx.db.get("rooms", roomId);
    if (createdRoom) await syncFriendRoomListing(ctx, createdRoom);
  }
  await ctx.db.insert("roomNotificationCursors", {
    roomId,
    recipientKey: HOST_RECIPIENT_KEY,
    lastReadVersion: 0,
    updatedAt: now
  });
  await appendAuditEvent(ctx, roomId, {
    eventId: `event_${crypto.randomUUID()}`,
    version: 0,
    actionType: "create_room",
    kind: "game",
    summary: "Created shared room",
    transactionIds: [],
    playerIds: [],
    actorLabel: "Host",
    createdAt: now,
    notify: false
  });
  return {
    publicId: args.publicId,
    status: "active" as const,
    name,
    state: snapshot,
    version: 0,
    endedAt: null
  };
}

export async function claimRoomHost(
  ctx: MutationCtx,
  args: { publicId: string; hostSecret: string; controllerId: string }
) {
  const room = await requireHost(ctx, args.publicId, args.hostSecret);
  if (room.status !== "active") fail("ROOM_NOT_ACTIVE", "This room is no longer active.");
  if (!validIdentifier(args.controllerId)) {
    fail("INVALID_ARGUMENT", "Host controller identity is invalid.");
  }
  await ctx.db.patch(room._id, { hostControllerId: args.controllerId, lastActivityAt: Date.now() });
  return null;
}

export async function setRoomFriendVisibility(
  ctx: MutationCtx,
  args: { publicId: string; hostSecret: string; visible: boolean }
) {
  const room = await requireHost(ctx, args.publicId, args.hostSecret);
  if (room.status !== "active") fail("ROOM_NOT_ACTIVE", "This room is no longer active.");
  if (!room.hostProfileId) {
    fail("INVALID_ARGUMENT", "This room is not linked to a friend profile.");
  }
  await ctx.db.patch(room._id, {
    visibleToFriends: args.visible,
    lastActivityAt: Date.now()
  });
  await syncFriendRoomListing(ctx, { ...room, visibleToFriends: args.visible });
  return null;
}

export async function endRoom(
  ctx: MutationCtx,
  args: {
    publicId: string;
    hostSecret: string;
    controllerId: string;
    expectedVersion: number;
    clientActionId: string;
  }
) {
  const room = await requireHost(ctx, args.publicId, args.hostSecret);
  if (!validIdentifier(args.clientActionId)) {
    fail("INVALID_ARGUMENT", "Client action identity is invalid.");
  }
  const processed = await ctx.db
    .query("processedActions")
    .withIndex("by_room_id_and_client_action_id", (index) =>
      index.eq("roomId", room._id).eq("clientActionId", args.clientActionId)
    )
    .unique();
  if (processed && room.status === "ended") {
    return await publicRoomWithActivity(ctx, room, room.state as GameState, HOST_RECIPIENT_KEY, {
      duplicate: true
    });
  }
  if (room.status !== "active") fail("ROOM_NOT_ACTIVE", "This room is no longer active.");
  if (room.hostControllerId !== args.controllerId) {
    fail("DUPLICATE_CONTROLLER", "Another tab controls this hosted room.");
  }
  if (!Number.isSafeInteger(args.expectedVersion) || args.expectedVersion !== room.version) {
    fail("VERSION_CONFLICT", `Room changed; reload version ${room.version}.`);
  }
  const endedAt = Date.now();
  await ctx.db.patch(room._id, { status: "ended", endedAt, lastActivityAt: endedAt });
  await releaseActiveRoomSlot(ctx, room);
  if (room.hostProfileId) {
    await syncFriendRoomListing(ctx, { ...room, status: "ended" });
    await clearLegacyActiveRoom(ctx, room, endedAt);
  }
  await appendAuditEvent(ctx, room._id, {
    eventId: `event_${crypto.randomUUID()}`,
    version: room.version,
    actionType: "end_room",
    kind: "game",
    summary: "Ended shared room",
    transactionIds: [],
    playerIds: [],
    actorLabel: "Host",
    createdAt: endedAt,
    notify: false
  });
  await ctx.db.insert("processedActions", {
    roomId: room._id,
    clientActionId: args.clientActionId,
    resultingVersion: room.version,
    processedAt: endedAt
  });
  return await publicRoomWithActivity(
    ctx,
    { ...room, status: "ended", endedAt },
    room.state as GameState,
    HOST_RECIPIENT_KEY
  );
}
