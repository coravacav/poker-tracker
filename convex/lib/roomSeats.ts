// Seat claims: which guest phone holds each active player's seat, and which
// seat is the host's own. First come, first served, one phone per seat; the
// host can release a claim, move a phone to an open seat, or mark their own
// seat. A claim (or host seat) on a player who is no longer an active player
// counts as no claim, so archived or removed players' seats are simply free.
import type { GameState, Player } from "../../src/domain/pokerTypes";
import { MAX_ROOM_GUEST_RECORDS, MAX_ROOM_GUESTS } from "../../src/session/roomProtocol";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { requireGuest, requireHost } from "./roomAccess";
import { fail } from "./roomErrors";

const MAX_PLAYER_ID_LENGTH = 200;

/** The room's active players in seat order: the seats a phone can claim. */
export function activeSeatPlayers(room: Doc<"rooms">): Player[] {
  const players = (room.state as GameState | undefined)?.players ?? [];
  return players
    .filter((player) => player.isActive)
    .sort((left, right) => left.seatIndex - right.seatIndex);
}

function activeSeatPlayer(room: Doc<"rooms">, playerId: string): Player | null {
  return activeSeatPlayers(room).find((player) => player.id === playerId) ?? null;
}

/** The host's own seat, while it is an active player. */
export function liveHostPlayerId(room: Doc<"rooms">): string | null {
  return room.hostPlayerId !== undefined && activeSeatPlayer(room, room.hostPlayerId)
    ? room.hostPlayerId
    : null;
}

/** The seat a guest holds right now, or null (revoked, unclaimed, or a player no longer active). */
export function liveSeatOf(room: Doc<"rooms">, guest: Doc<"roomGuests">): string | null {
  if (guest.revokedAt !== undefined || guest.playerId === undefined) return null;
  if (!activeSeatPlayer(room, guest.playerId)) return null;
  return guest.playerId === liveHostPlayerId(room) ? null : guest.playerId;
}

/** The guest (other than `exceptGuestId`) holding a seat, if any. */
async function seatHolder(
  ctx: QueryCtx | MutationCtx,
  room: Doc<"rooms">,
  playerId: string,
  exceptGuestId?: Id<"roomGuests">
) {
  const claims = await ctx.db
    .query("roomGuests")
    .withIndex("by_room_id_and_player_id", (index) =>
      index.eq("roomId", room._id).eq("playerId", playerId)
    )
    .take(MAX_ROOM_GUEST_RECORDS);
  return claims.find((guest) => guest._id !== exceptGuestId && guest.revokedAt === undefined) ?? null;
}

/** Live claims of the room's good-standing guests, keyed by seat. */
export async function seatClaims(ctx: QueryCtx | MutationCtx, room: Doc<"rooms">) {
  const guests = await ctx.db
    .query("roomGuests")
    .withIndex("by_room_id_and_revoked_at", (index) =>
      index.eq("roomId", room._id).eq("revokedAt", undefined)
    )
    .take(MAX_ROOM_GUESTS);
  const claims = new Map<string, Doc<"roomGuests">>();
  for (const guest of guests) {
    const playerId = liveSeatOf(room, guest);
    if (playerId !== null && !claims.has(playerId)) claims.set(playerId, guest);
  }
  return claims;
}

/**
 * The seats a guest (or someone holding the invitation) chooses from. `claimed`
 * means another phone holds it, so it never names or identifies other guests.
 */
export async function seatOptions(
  ctx: QueryCtx | MutationCtx,
  room: Doc<"rooms">,
  viewerGuestId?: Id<"roomGuests">
) {
  const claims = await seatClaims(ctx, room);
  const hostPlayerId = liveHostPlayerId(room);
  return activeSeatPlayers(room).map((player) => {
    const holder = claims.get(player.id);
    return {
      playerId: player.id,
      name: player.name,
      claimed: holder !== undefined && holder._id !== viewerGuestId,
      isHost: player.id === hostPlayerId
    };
  });
}

/** The host's seat list: who holds each active seat, and which one is the host's own. */
export async function hostSeats(
  ctx: QueryCtx,
  room: Doc<"rooms">,
  onlineGuestIds: Set<string>
) {
  const claims = await seatClaims(ctx, room);
  const hostPlayerId = liveHostPlayerId(room);
  return activeSeatPlayers(room).map((player) => {
    const holder = claims.get(player.id);
    return {
      playerId: player.id,
      name: player.name,
      isHost: player.id === hostPlayerId,
      guest: holder
        ? {
            id: holder._id,
            displayName: holder.displayName,
            connected: onlineGuestIds.has(String(holder._id))
          }
        : null
    };
  });
}

function seatDisplayName(player: Player) {
  return player.name.trim().slice(0, 40) || "Player";
}

/**
 * Checks that a seat is open to this guest: an active player, not the host's
 * seat, and not held by another good-standing guest. Two phones claiming the
 * same seat both read that seat's index range, so the second write conflicts
 * and retries into "taken".
 */
async function requireOpenSeat(
  ctx: MutationCtx,
  room: Doc<"rooms">,
  playerId: string,
  guestId: Id<"roomGuests">
) {
  const player = playerId.length <= MAX_PLAYER_ID_LENGTH ? activeSeatPlayer(room, playerId) : null;
  if (!player) fail("INVALID_ARGUMENT", "That seat is no longer at the table.");
  if (playerId === liveHostPlayerId(room)) fail("SEAT_TAKEN", "That's the host's seat.");
  if (await seatHolder(ctx, room, playerId, guestId)) {
    fail("SEAT_TAKEN", "Someone else just took that seat. Pick another.");
  }
  return player;
}

/**
 * Gives a guest a seat (moving any seat they held) and makes the seat's
 * player name their display name. Returns that name.
 */
export async function claimSeatForGuest(
  ctx: MutationCtx,
  room: Doc<"rooms">,
  guest: Doc<"roomGuests">,
  playerId: string
) {
  if (guest.revokedAt !== undefined) {
    fail("INVALID_ARGUMENT", "This guest no longer has access to the room.");
  }
  const player = await requireOpenSeat(ctx, room, playerId, guest._id);
  const displayName = seatDisplayName(player);
  if (guest.playerId !== playerId || guest.displayName !== displayName) {
    await ctx.db.patch(guest._id, {
      playerId,
      claimedAt: guest.playerId === playerId ? guest.claimedAt : Date.now(),
      displayName
    });
  }
  return displayName;
}

export async function claimRoomSeat(
  ctx: MutationCtx,
  args: { publicId: string; guestSecret: string; playerId: string }
) {
  const { room, guest } = await requireGuest(ctx, args.publicId, args.guestSecret);
  if (room.status !== "active") fail("ROOM_NOT_ACTIVE", "This room is no longer active.");
  await claimSeatForGuest(ctx, room, guest, args.playerId);
  return null;
}

async function requireRoomGuest(ctx: MutationCtx, room: Doc<"rooms">, guestId: Id<"roomGuests">) {
  const guest = await ctx.db.get("roomGuests", guestId);
  if (!guest || guest.roomId !== room._id) fail("INVALID_ARGUMENT", "Guest was not found.");
  return guest;
}

/** Host: frees a guest's seat; the guest stays in the room without one. */
export async function releaseRoomSeat(
  ctx: MutationCtx,
  args: { publicId: string; hostSecret: string; guestId: Id<"roomGuests"> }
) {
  const room = await requireHost(ctx, args.publicId, args.hostSecret);
  if (room.status !== "active") fail("ROOM_NOT_ACTIVE", "This room is no longer active.");
  const guest = await requireRoomGuest(ctx, room, args.guestId);
  if (guest.playerId !== undefined) {
    await ctx.db.patch(guest._id, { playerId: undefined, claimedAt: undefined });
  }
  return null;
}

/** Host: puts a guest's phone on an open seat (moving it from any seat it held). */
export async function assignRoomSeat(
  ctx: MutationCtx,
  args: { publicId: string; hostSecret: string; guestId: Id<"roomGuests">; playerId: string }
) {
  const room = await requireHost(ctx, args.publicId, args.hostSecret);
  if (room.status !== "active") fail("ROOM_NOT_ACTIVE", "This room is no longer active.");
  const guest = await requireRoomGuest(ctx, room, args.guestId);
  await claimSeatForGuest(ctx, room, guest, args.playerId);
  return null;
}

/** Host: marks the host's own seat ("This is me"), or clears it with null. */
export async function setRoomHostPlayer(
  ctx: MutationCtx,
  args: { publicId: string; hostSecret: string; playerId: string | null }
) {
  const room = await requireHost(ctx, args.publicId, args.hostSecret);
  if (room.status !== "active") fail("ROOM_NOT_ACTIVE", "This room is no longer active.");
  if (args.playerId !== null) {
    if (args.playerId.length > MAX_PLAYER_ID_LENGTH || !activeSeatPlayer(room, args.playerId)) {
      fail("INVALID_ARGUMENT", "That seat is no longer at the table.");
    }
    const holder = await seatHolder(ctx, room, args.playerId);
    if (holder) {
      fail("SEAT_TAKEN", `${holder.displayName}'s phone holds that seat. Release it first.`);
    }
  }
  await ctx.db.patch(room._id, {
    hostPlayerId: args.playerId ?? undefined,
    lastActivityAt: Date.now()
  });
  return null;
}
