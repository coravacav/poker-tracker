// Guest access: invitations, joining, guest requests, presence, and the host
// controls that open, rotate, or revoke guest access.
import type { GameState } from "../../src/domain/pokerTypes";
import { parseFriendCode } from "../../src/session/friendCode";
import {
  applyHostedAction,
  MAX_ROOM_GUEST_RECORDS,
  MAX_ROOM_GUESTS,
  sanitizeGuestState
} from "../../src/session/roomProtocol";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { hashSecret, sameHash, validIdentifier, validSecret } from "./capabilities";
import { isDiscoverable, profileByFriendCode, publicHostProfile } from "./friendDiscovery";
import { requireGuest, requireHost, roomByPublicId } from "./roomAccess";
import { fail } from "./roomErrors";
import { GUEST_PRESENCE_INTERVAL_MS, presence } from "./roomPresence";
import { publicRoomWithActivity } from "./roomViews";

export async function joinRoomAsGuest(
  ctx: MutationCtx,
  room: Doc<"rooms">,
  guestSecret: string,
  rawDisplayName: string
) {
  if (!validSecret(guestSecret)) {
    fail("INVALID_CAPABILITY", "Guest capability is invalid.");
  }
  if (room.status !== "active") fail("ROOM_ENDED", "This shared room has ended.");
  if (room.joiningOpen === false) fail("ROOM_NOT_ACTIVE", "This room is not accepting new guests.");
  const displayName = rawDisplayName.trim();
  if (rawDisplayName.length > 200 || displayName.length < 1 || displayName.length > 40) {
    fail("INVALID_ARGUMENT", "Display name must be between 1 and 40 characters.");
  }

  const guestSecretHash = await hashSecret(guestSecret);
  const existingGuest = await ctx.db
    .query("roomGuests")
    .withIndex("by_room_id_and_guest_secret_hash", (index) =>
      index.eq("roomId", room._id).eq("guestSecretHash", guestSecretHash)
    )
    .unique();
  const now = Date.now();
  if (existingGuest && existingGuest.revokedAt !== undefined) {
    // A revoked capability must not be revived (and must not create a second
    // guest row with the same verifier).
    fail("INVALID_CAPABILITY", "Guest session is invalid or revoked.");
  }
  let guestId = existingGuest?._id;
  if (existingGuest) {
    await ctx.db.patch(existingGuest._id, { displayName });
  } else {
    // Count every guest record, revoked ones included, so neither the active
    // guest count nor the total number of guest rows per room is unbounded.
    const guests = await ctx.db
      .query("roomGuests")
      .withIndex("by_room_id", (index) => index.eq("roomId", room._id))
      .take(MAX_ROOM_GUEST_RECORDS);
    if (
      guests.length >= MAX_ROOM_GUEST_RECORDS ||
      guests.filter((guest) => guest.revokedAt === undefined).length >= MAX_ROOM_GUESTS
    ) {
      fail("ROOM_LIMIT_REACHED", "This room has reached its guest limit.");
    }
    guestId = await ctx.db.insert("roomGuests", {
      roomId: room._id,
      displayName,
      guestSecretHash,
      joinedAt: now
    });
  }
  if (!guestId) {
    fail("INVALID_CAPABILITY", "Guest session could not be created.");
  }
  const guestRecipientKey = String(guestId);
  const existingCursor = await ctx.db
    .query("roomNotificationCursors")
    .withIndex("by_room_id_and_recipient_key", (index) =>
      index.eq("roomId", room._id).eq("recipientKey", guestRecipientKey)
    )
    .unique();
  if (!existingCursor) {
    await ctx.db.insert("roomNotificationCursors", {
      roomId: room._id,
      recipientKey: guestRecipientKey,
      lastReadVersion: room.version,
      updatedAt: now
    });
  }
  return await publicRoomWithActivity(
    ctx,
    room,
    sanitizeGuestState(room.state as GameState),
    guestRecipientKey,
    { displayName, hostProfile: await publicHostProfile(ctx, room) }
  );
}

export async function previewInvite(
  ctx: QueryCtx,
  args: { publicId: string; inviteSecret: string }
) {
  if (!validSecret(args.inviteSecret)) {
    return { status: "invalid" as const };
  }
  const room = await roomByPublicId(ctx, args.publicId);
  if (!room) return { status: "invalid" as const };
  const presentedHash = await hashSecret(args.inviteSecret);
  if (!sameHash(room.inviteSecretHash, presentedHash)) {
    return { status: "invalid" as const };
  }
  if (room.joiningOpen === false && room.status === "active") {
    return { status: "closed" as const, name: room.name };
  }
  return { status: room.status, name: room.name };
}

export async function joinWithInvite(
  ctx: MutationCtx,
  args: { publicId: string; inviteSecret: string; guestSecret: string; displayName: string }
) {
  if (!validSecret(args.inviteSecret) || !validSecret(args.guestSecret)) {
    fail("INVALID_CAPABILITY", "Invitation is invalid.");
  }
  const room = await roomByPublicId(ctx, args.publicId);
  if (!room) fail("ROOM_NOT_FOUND", "Shared room was not found.");
  const inviteHash = await hashSecret(args.inviteSecret);
  if (!sameHash(room.inviteSecretHash, inviteHash)) {
    fail("INVALID_CAPABILITY", "Invitation is invalid.");
  }
  return await joinRoomAsGuest(ctx, room, args.guestSecret, args.displayName);
}

export async function joinWithFriendCode(
  ctx: MutationCtx,
  args: { publicId: string; friendCode: string; guestSecret: string; displayName: string }
) {
  const friendCode = parseFriendCode(args.friendCode);
  if (!friendCode) fail("INVALID_CAPABILITY", "Friend code is invalid.");
  const profile = await profileByFriendCode(ctx, friendCode);
  if (!profile) fail("INVALID_CAPABILITY", "Friend code is invalid.");
  const room = await roomByPublicId(ctx, args.publicId);
  // Authorize against the room document itself: it must belong to this
  // profile and currently be discoverable (active and visible to friends).
  if (!room || room.hostProfileId !== profile._id || !isDiscoverable(room)) {
    fail("ROOM_NOT_FOUND", "This friend is not sharing that room.");
  }
  return await joinRoomAsGuest(ctx, room, args.guestSecret, args.displayName);
}

export async function submitGuestTransactionRequest(
  ctx: MutationCtx,
  args: { publicId: string; guestSecret: string; transaction: any }
) {
  const { room, guest } = await requireGuest(ctx, args.publicId, args.guestSecret);
  if (room.status !== "active") fail("ROOM_NOT_ACTIVE", "This room is no longer active.");
  const candidate = applyHostedAction(
    room.state as GameState,
    { type: "add_transaction", transaction: args.transaction },
    new Date().toISOString(),
    () => `transaction_${crypto.randomUUID()}`
  );
  if ("error" in candidate) fail("INVALID_ARGUMENT", candidate.error);

  const pending = await ctx.db
    .query("roomGuestRequests")
    .withIndex("by_guest_id", (index) => index.eq("guestId", guest._id))
    .order("desc")
    .take(25);
  if (pending.filter((request) => request.status === "pending").length >= 10) {
    fail("ROOM_LIMIT_REACHED", "Wait for the host to review your pending requests.");
  }

  return await ctx.db.insert("roomGuestRequests", {
    roomId: room._id,
    guestId: guest._id,
    transaction: args.transaction,
    status: "pending",
    createdAt: Date.now()
  });
}

export async function recordGuestHeartbeat(
  ctx: MutationCtx,
  args: { publicId: string; guestSecret: string; sessionId: string }
) {
  const { room, guest } = await requireGuest(ctx, args.publicId, args.guestSecret);
  if (room.status === "active" && validIdentifier(args.sessionId)) {
    await presence.heartbeat(
      ctx,
      room.publicId,
      String(guest._id),
      args.sessionId,
      GUEST_PRESENCE_INTERVAL_MS
    );
  }
  return null;
}

export async function setRoomJoiningOpen(
  ctx: MutationCtx,
  args: { publicId: string; hostSecret: string; open: boolean }
) {
  const room = await requireHost(ctx, args.publicId, args.hostSecret);
  if (room.status !== "active") fail("ROOM_NOT_ACTIVE", "This room is no longer active.");
  await ctx.db.patch(room._id, { joiningOpen: args.open });
  return null;
}

export async function rotateRoomInvite(
  ctx: MutationCtx,
  args: { publicId: string; hostSecret: string; inviteSecret: string }
) {
  const room = await requireHost(ctx, args.publicId, args.hostSecret);
  if (room.status !== "active") fail("ROOM_NOT_ACTIVE", "This room is no longer active.");
  if (!validSecret(args.inviteSecret) || args.inviteSecret === args.hostSecret) {
    fail("INVALID_ARGUMENT", "New invitation capability is invalid.");
  }
  await ctx.db.patch(room._id, {
    inviteSecretHash: await hashSecret(args.inviteSecret),
    joiningOpen: true,
    lastActivityAt: Date.now()
  });
  return null;
}

export async function revokeRoomGuest(
  ctx: MutationCtx,
  args: { publicId: string; hostSecret: string; guestId: Id<"roomGuests"> }
) {
  const room = await requireHost(ctx, args.publicId, args.hostSecret);
  const guest = await ctx.db.get("roomGuests", args.guestId);
  if (!guest || guest.roomId !== room._id) fail("INVALID_ARGUMENT", "Guest was not found.");
  if (guest.revokedAt === undefined) {
    await ctx.db.patch(guest._id, { revokedAt: Date.now() });
  }
  return null;
}
