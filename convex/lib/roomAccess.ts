// Capability checks: resolve a room by public id and verify host or guest secrets.
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { hashSecret, sameHash, validSecret } from "./capabilities";
import { fail } from "./roomErrors";

export async function roomByPublicId(ctx: QueryCtx | MutationCtx, publicId: string) {
  return await ctx.db
    .query("rooms")
    .withIndex("by_public_id", (index) => index.eq("publicId", publicId))
    .unique();
}

export async function requireHost(ctx: QueryCtx | MutationCtx, publicId: string, hostSecret: string) {
  if (!validSecret(hostSecret)) {
    fail("INVALID_CAPABILITY", "Host capability is invalid.");
  }
  const room = await roomByPublicId(ctx, publicId);
  if (!room) fail("ROOM_NOT_FOUND", "Shared room was not found.");
  const presentedHash = await hashSecret(hostSecret);
  if (!sameHash(room.hostSecretHash, presentedHash)) {
    fail("INVALID_CAPABILITY", "Host capability is invalid.");
  }
  return room;
}

export async function requireGuest(ctx: QueryCtx | MutationCtx, publicId: string, guestSecret: string) {
  if (!validSecret(guestSecret)) {
    fail("INVALID_CAPABILITY", "Guest capability is invalid.");
  }
  const room = await roomByPublicId(ctx, publicId);
  if (!room) fail("ROOM_NOT_FOUND", "Shared room was not found.");
  const secretHash = await hashSecret(guestSecret);
  const guest = await ctx.db
    .query("roomGuests")
    .withIndex("by_room_id_and_guest_secret_hash", (index) =>
      index.eq("roomId", room._id).eq("guestSecretHash", secretHash)
    )
    .unique();
  if (!guest || guest.revokedAt !== undefined) {
    fail("INVALID_CAPABILITY", "Guest session is invalid or revoked.");
  }
  return { room, guest };
}
