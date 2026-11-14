// Seat claims: which guest phone holds each active player's seat, and which
// seat is the host's own. First come, first served, one phone per seat; the
// host can release a claim, move a phone to an open seat, or mark their own
// seat.
//
// A claim names a player by id and also records who that player was when it
// was made (name and people link). Seat identity authorizes what a phone may
// confirm, so a claim only counts while its player is active and still that
// same person: any host change that renames, relinks, archives, or removes a
// claimed player releases the claim (releaseChangedSeats), and a claim that
// somehow no longer matches is never treated as held.
import type { GameState, Player } from "../../src/domain/pokerTypes";
import { MAX_ROOM_GUEST_RECORDS, MAX_ROOM_GUESTS } from "../../src/session/roomProtocol";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { cancelGuestAgreements, cancelSeatAgreements } from "./agreementCleanup";
import { requireGuest, requireHost } from "./roomAccess";
import { fail } from "./roomErrors";

const MAX_PLAYER_ID_LENGTH = 200;
/** Seats a room remembers as "released by the host". */
const MAX_HOST_RELEASED_SEATS = 50;

/** Seats the host released; no phone may claim them on its own. */
function hostReleasedSeats(room: Pick<Doc<"rooms">, "releasedSeatPlayerIds">): string[] {
  return room.releasedSeatPlayerIds ?? [];
}

/** The room's active players in seat order: the seats a phone can claim. */
export function activeSeatPlayers(room: Pick<Doc<"rooms">, "state">): Player[] {
  const players = (room.state as GameState | undefined)?.players ?? [];
  return players
    .filter((player) => player.isActive)
    .sort((left, right) => left.seatIndex - right.seatIndex);
}

function activeSeatPlayer(room: Pick<Doc<"rooms">, "state">, playerId: string): Player | null {
  return activeSeatPlayers(room).find((player) => player.id === playerId) ?? null;
}

/** The host's own seat, while it is an active player. */
export function liveHostPlayerId(room: Doc<"rooms">): string | null {
  return room.hostPlayerId !== undefined && activeSeatPlayer(room, room.hostPlayerId)
    ? room.hostPlayerId
    : null;
}

function samePerson(player: Player, guest: Doc<"roomGuests">) {
  return player.name === guest.claimedName && (player.personId ?? null) === (guest.claimedPersonId ?? null);
}

/**
 * The seat a guest holds right now, or null: revoked, unclaimed, a player no
 * longer active, or a player who is no longer the person the phone claimed.
 */
export function liveSeatOf(room: Doc<"rooms">, guest: Doc<"roomGuests">): string | null {
  if (guest.revokedAt !== undefined || guest.playerId === undefined) return null;
  const player = activeSeatPlayer(room, guest.playerId);
  if (!player || !samePerson(player, guest)) return null;
  return guest.playerId === liveHostPlayerId(room) ? null : guest.playerId;
}

/** The name a guest is shown under: their seat's player while seated, else the name they joined with. */
export function guestShownName(room: Doc<"rooms">, guest: Doc<"roomGuests">): string {
  const playerId = liveSeatOf(room, guest);
  const player = playerId ? activeSeatPlayer(room, playerId) : null;
  return player ? seatDisplayName(player) : guest.displayName;
}

const releasedClaim = {
  playerId: undefined,
  claimedAt: undefined,
  claimedName: undefined,
  claimedPersonId: undefined
};

/**
 * Closes the agreements a guest's seat claim stood behind: their own open
 * proposals (made from that seat) and open entries aimed at the seat.
 */
export async function cancelClaimAgreements(ctx: MutationCtx, guest: Doc<"roomGuests">) {
  await cancelGuestAgreements(ctx, guest._id, "seat_lost");
  if (guest.playerId !== undefined) await cancelSeatAgreements(ctx, guest.roomId, guest.playerId);
}

/** Takes a guest off their seat, closing the agreements that claim stood behind. */
async function releaseClaim(
  ctx: MutationCtx,
  guest: Doc<"roomGuests">,
  extra: Partial<Doc<"roomGuests">>
) {
  await ctx.db.patch(guest._id, { ...releasedClaim, ...extra });
  await cancelClaimAgreements(ctx, guest);
}

/** Good-standing guests with a claim (live or not) on a seat. */
async function claimsOn(ctx: QueryCtx | MutationCtx, room: Doc<"rooms">, playerId: string) {
  return (await ctx.db
    .query("roomGuests")
    .withIndex("by_room_id_and_player_id", (index) =>
      index.eq("roomId", room._id).eq("playerId", playerId)
    )
    .take(MAX_ROOM_GUEST_RECORDS))
    .filter((guest) => guest.revokedAt === undefined);
}

/**
 * After a host change, releases every claim whose player was renamed,
 * relinked, archived, or removed, so a phone never silently becomes someone
 * else and no claim lies dormant to come back later. Returns the host seat to
 * keep (cleared when the host's player is no longer active).
 */
export async function releaseChangedSeats(
  ctx: MutationCtx,
  room: Doc<"rooms">,
  before: GameState,
  after: GameState
): Promise<string | undefined> {
  const afterById = new Map(after.players.map((player) => [player.id, player]));
  for (const player of before.players) {
    const next = afterById.get(player.id);
    const isActive = next?.isActive === true;
    // Inactive before and after: nothing could have been held here.
    if (!player.isActive && !isActive) continue;
    // Reactivating a player also releases any claim left from before.
    const unchanged =
      player.isActive &&
      next?.isActive === true &&
      next.name === player.name &&
      (next.personId ?? null) === (player.personId ?? null);
    if (unchanged) continue;
    for (const guest of await claimsOn(ctx, room, player.id)) {
      await releaseClaim(ctx, guest, { seatLost: "changed" });
    }
    // Entries aimed at this seat were meant for the player as they were.
    await cancelSeatAgreements(ctx, room._id, player.id);
  }
  if (room.hostPlayerId !== undefined && !afterById.get(room.hostPlayerId)?.isActive) return undefined;
  return room.hostPlayerId;
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
 * `releasedByHost` marks seats the host released, which only the host can fill.
 */
export async function seatOptions(
  ctx: QueryCtx | MutationCtx,
  room: Doc<"rooms">,
  viewer?: Doc<"roomGuests">
) {
  const claims = await seatClaims(ctx, room);
  const hostPlayerId = liveHostPlayerId(room);
  const released = new Set(hostReleasedSeats(room));
  return activeSeatPlayers(room).map((player) => {
    const holder = claims.get(player.id);
    return {
      playerId: player.id,
      name: player.name,
      claimed: holder !== undefined && holder._id !== viewer?._id,
      isHost: player.id === hostPlayerId,
      ...(released.has(player.id) && holder === undefined ? { releasedByHost: true } : {})
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
            displayName: seatDisplayName(player),
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
 * and retries into "taken". A leftover claim that no longer matches its player
 * is released here, so it can never come back alongside the new one.
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
  for (const guest of await claimsOn(ctx, room, playerId)) {
    if (guest._id === guestId) continue;
    if (samePerson(player, guest)) fail("SEAT_TAKEN", "Someone else just took that seat. Pick another.");
    await releaseClaim(ctx, guest, { seatLost: "changed" });
  }
  return player;
}

/**
 * Gives a guest a seat (moving any seat they held), recording who the seat's
 * player is, and makes that player's name their display name. No phone can
 * take a seat the host released on its own; `byHost` (the host's Move) puts
 * the phone there anyway and lifts the block.
 */
export async function claimSeatForGuest(
  ctx: MutationCtx,
  room: Doc<"rooms">,
  guest: Doc<"roomGuests">,
  playerId: string,
  byHost = false
) {
  if (guest.revokedAt !== undefined) {
    fail("INVALID_ARGUMENT", "This guest no longer has access to the room.");
  }
  const released = hostReleasedSeats(room);
  if (!byHost && released.includes(playerId) && liveSeatOf(room, guest) !== playerId) {
    fail("SEAT_TAKEN", "The host released that seat. Ask the host to move you there.");
  }
  const player = await requireOpenSeat(ctx, room, playerId, guest._id);
  const keepClaimedAt = liveSeatOf(room, guest) === playerId;
  // Moving seats: what the old claim stood behind no longer stands.
  if (!keepClaimedAt && guest.playerId !== undefined) await cancelClaimAgreements(ctx, guest);
  if (byHost && released.includes(playerId)) {
    await ctx.db.patch(room._id, { releasedSeatPlayerIds: released.filter((id) => id !== playerId) });
  }
  await ctx.db.patch(guest._id, {
    playerId,
    claimedAt: keepClaimedAt ? guest.claimedAt : Date.now(),
    claimedName: player.name,
    claimedPersonId: player.personId,
    displayName: seatDisplayName(player),
    seatLost: undefined
  });
  return seatDisplayName(player);
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

/**
 * Host: frees the seat a guest's phone holds; the guest stays in the room
 * without one. No phone can then claim that seat on its own (a fresh join
 * included) until the host moves one there. `playerId` is the seat the host
 * saw, so a phone that has since moved isn't released.
 */
export async function releaseRoomSeat(
  ctx: MutationCtx,
  args: { publicId: string; hostSecret: string; guestId: Id<"roomGuests">; playerId: string }
) {
  const room = await requireHost(ctx, args.publicId, args.hostSecret);
  if (room.status !== "active") fail("ROOM_NOT_ACTIVE", "This room is no longer active.");
  const guest = await requireRoomGuest(ctx, room, args.guestId);
  if (liveSeatOf(room, guest) !== args.playerId) {
    fail("INVALID_ARGUMENT", "That phone is no longer in that seat.");
  }
  await releaseClaim(ctx, guest, { seatLost: "released" });
  const released = hostReleasedSeats(room).filter((id) => id !== args.playerId);
  await ctx.db.patch(room._id, {
    releasedSeatPlayerIds: [...released, args.playerId].slice(-MAX_HOST_RELEASED_SEATS)
  });
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
  await claimSeatForGuest(ctx, room, guest, args.playerId, true);
  return null;
}

/** Host: marks the host's own seat ("This is me"), or says they aren't playing with null. */
export async function setRoomHostPlayer(
  ctx: MutationCtx,
  args: { publicId: string; hostSecret: string; playerId: string | null }
) {
  const room = await requireHost(ctx, args.publicId, args.hostSecret);
  if (room.status !== "active") fail("ROOM_NOT_ACTIVE", "This room is no longer active.");
  if (args.playerId !== null) {
    const player = args.playerId.length <= MAX_PLAYER_ID_LENGTH ? activeSeatPlayer(room, args.playerId) : null;
    if (!player) fail("INVALID_ARGUMENT", "That seat is no longer at the table.");
    for (const guest of await claimsOn(ctx, room, args.playerId)) {
      if (samePerson(player, guest)) {
        fail("SEAT_TAKEN", `${seatDisplayName(player)}'s phone holds that seat. Release it first.`);
      }
      await releaseClaim(ctx, guest, { seatLost: "changed" });
    }
  }
  const released = hostReleasedSeats(room);
  await ctx.db.patch(room._id, {
    // The host taking a released seat fills it.
    ...(args.playerId !== null && released.includes(args.playerId)
      ? { releasedSeatPlayerIds: released.filter((id) => id !== args.playerId) }
      : {}),
    hostPlayerId: args.playerId ?? undefined,
    hostNotPlaying: args.playerId === null ? true : undefined,
    lastActivityAt: Date.now()
  });
  return null;
}
