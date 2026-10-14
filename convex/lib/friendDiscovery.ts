// Friend-profile ownership checks and followed-host room discovery, shared by
// convex/friendProfiles.ts and convex/rooms.ts.
//
// Discovery model: a room is discoverable by holders of its host's current
// friend code while it is active, linked to the host profile, and marked
// visible to friends. Every such room has exactly one `friendRoomListings`
// row, kept in sync by `syncFriendRoomListing` whenever a room's status,
// visibility, or name changes. Discovery reads only these small rows, so
// following a host never reads (or subscribes to) full room snapshots.
import { parseFriendCode } from "../../src/session/friendCode";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { hashSecret, sameHash, validSecret } from "./capabilities";

/** Upper bound on rooms returned per followed host. */
export const MAX_DISCOVERABLE_ROOMS_PER_FRIEND = 5;

export type DiscoverableRoom = {
  publicId: string;
  name: string;
  createdAt: number;
};

export async function profileByFriendCode(
  ctx: QueryCtx | MutationCtx,
  friendCode: string
): Promise<Doc<"friendProfiles"> | null> {
  return await ctx.db
    .query("friendProfiles")
    .withIndex("by_friend_code", (index) => index.eq("friendCode", friendCode))
    .unique();
}

export type ProfileOwnerCheck =
  | { ok: true; profile: Doc<"friendProfiles"> }
  | { ok: false; reason: "invalid_argument" | "not_found" | "invalid_capability" };

/** Verifies the profile-owner capability for the profile behind a friend code. */
export async function verifyProfileOwner(
  ctx: QueryCtx | MutationCtx,
  presentedFriendCode: string,
  ownerSecret: string
): Promise<ProfileOwnerCheck> {
  const friendCode = parseFriendCode(presentedFriendCode);
  if (!friendCode || !validSecret(ownerSecret)) {
    return { ok: false, reason: "invalid_argument" };
  }
  const profile = await profileByFriendCode(ctx, friendCode);
  if (!profile) return { ok: false, reason: "not_found" };
  if (!sameHash(profile.ownerSecretHash, await hashSecret(ownerSecret))) {
    return { ok: false, reason: "invalid_capability" };
  }
  return { ok: true, profile };
}

export function isDiscoverable(room: Doc<"rooms">): boolean {
  return (
    room.status === "active" &&
    room.hostProfileId !== undefined &&
    room.visibleToFriends === true
  );
}

/**
 * Brings the room's discovery listing in line with the room document. Call it
 * with the room as it will be after the current mutation's patch.
 */
export async function syncFriendRoomListing(ctx: MutationCtx, room: Doc<"rooms">) {
  const listing = await ctx.db
    .query("friendRoomListings")
    .withIndex("by_room_id", (index) => index.eq("roomId", room._id))
    .unique();
  if (!isDiscoverable(room) || room.hostProfileId === undefined) {
    if (listing) await ctx.db.delete(listing._id);
    return;
  }
  if (!listing) {
    await ctx.db.insert("friendRoomListings", {
      hostProfileId: room.hostProfileId,
      roomId: room._id,
      publicId: room.publicId,
      name: room.name,
      roomCreatedAt: room.createdAt
    });
  } else if (listing.name !== room.name) {
    await ctx.db.patch(listing._id, { name: room.name });
  }
}

/**
 * Removes the deprecated single-room pointer when its room stops being active.
 * Profiles written before listings existed may still carry `activeRoomId`.
 */
export async function clearLegacyActiveRoom(ctx: MutationCtx, room: Doc<"rooms">, now: number) {
  if (!room.hostProfileId) return;
  const profile = await ctx.db.get("friendProfiles", room.hostProfileId);
  if (profile?.activeRoomId === room._id) {
    await ctx.db.patch(profile._id, { activeRoomId: undefined, updatedAt: now });
  }
}

/** Bounded list of the host's rooms that followers may currently see. */
export async function discoverableRooms(
  ctx: QueryCtx,
  profile: Doc<"friendProfiles">
): Promise<DiscoverableRoom[]> {
  const listings = await ctx.db
    .query("friendRoomListings")
    .withIndex("by_host_profile_id", (index) => index.eq("hostProfileId", profile._id))
    .order("desc")
    .take(MAX_DISCOVERABLE_ROOMS_PER_FRIEND);
  const rooms: DiscoverableRoom[] = listings.map((listing) => ({
    publicId: listing.publicId,
    name: listing.name,
    createdAt: listing.roomCreatedAt
  }));

  // Legacy rooms (created before listings) are found through the old pointer
  // and re-validated against the room document itself.
  const legacyRoomId = profile.activeRoomId;
  if (legacyRoomId && !listings.some((listing) => listing.roomId === legacyRoomId)) {
    const legacyRoom = await ctx.db.get("rooms", legacyRoomId);
    if (legacyRoom && isDiscoverable(legacyRoom) && legacyRoom.hostProfileId === profile._id) {
      rooms.push({
        publicId: legacyRoom.publicId,
        name: legacyRoom.name,
        createdAt: legacyRoom.createdAt
      });
    }
  }

  return rooms
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, MAX_DISCOVERABLE_ROOMS_PER_FRIEND);
}

/**
 * The host profile shown to a room's guests so they can follow the host. A
 * friend-code rotation hides the profile from guests of rooms created before
 * the rotation, so old guest sessions cannot learn the replacement code.
 */
export async function publicHostProfile(
  ctx: QueryCtx | MutationCtx,
  room: Doc<"rooms">
): Promise<{ friendCode: string; displayName: string } | null> {
  if (!room.hostProfileId) return null;
  const profile = await ctx.db.get("friendProfiles", room.hostProfileId);
  if (!profile) return null;
  if (profile.friendCodeRotatedAt !== undefined && room.createdAt <= profile.friendCodeRotatedAt) {
    return null;
  }
  return { friendCode: profile.friendCode, displayName: profile.displayName };
}
