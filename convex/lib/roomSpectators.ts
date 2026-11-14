// The read-only watch link: the host turns it on, rotates, or turns it off;
// spectators see a sanitized table and the recent feed, and count as watchers
// through their own presence key. A watch secret never joins, previews an
// invitation, or sends requests: it is checked only by requireSpectator.
import type { GameState } from "../../src/domain/pokerTypes";
import { sanitizeSpectatorState } from "../../src/session/roomProtocol";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { hashSecret, sameHash, validIdentifier, validSecret } from "./capabilities";
import { requireHost, requireSpectator } from "./roomAccess";
import { fail } from "./roomErrors";
import { recentPublicEvents } from "./roomNotifications";
import {
  GUEST_PRESENCE_INTERVAL_MS,
  MAX_ROOM_WATCHERS,
  onlineWatchers,
  presence,
  watcherPresenceKey
} from "./roomPresence";
import { publicRoom } from "./roomViews";

/** Feed entries a watcher sees, newest first. */
const SPECTATOR_FEED_EVENTS = 40;

export async function rotateRoomSpectatorLink(
  ctx: MutationCtx,
  args: { publicId: string; hostSecret: string; spectatorSecret: string | null }
) {
  const room = await requireHost(ctx, args.publicId, args.hostSecret);
  if (room.status !== "active") fail("ROOM_NOT_ACTIVE", "This room is no longer active.");
  let spectatorSecretHash: string | undefined;
  if (args.spectatorSecret !== null) {
    if (!validSecret(args.spectatorSecret) || args.spectatorSecret === args.hostSecret) {
      fail("INVALID_ARGUMENT", "New watch link capability is invalid.");
    }
    spectatorSecretHash = await hashSecret(args.spectatorSecret);
    // The watch secret must not double as any other capability in the room.
    const guestWithSecret = await ctx.db
      .query("roomGuests")
      .withIndex("by_room_id_and_guest_secret_hash", (index) =>
        index.eq("roomId", room._id).eq("guestSecretHash", spectatorSecretHash!)
      )
      .first();
    if (
      sameHash(room.hostSecretHash, spectatorSecretHash) ||
      sameHash(room.inviteSecretHash, spectatorSecretHash) ||
      guestWithSecret
    ) {
      fail("INVALID_ARGUMENT", "New watch link capability is invalid.");
    }
  }
  await ctx.db.patch(room._id, { spectatorSecretHash, lastActivityAt: Date.now() });
  // Watchers of the old link are gone; the count starts over for the new one.
  await presence.removeRoom(ctx, watcherPresenceKey(room));
  return null;
}

export async function spectatorRoomView(
  ctx: QueryCtx,
  args: { publicId: string; spectatorSecret: string }
) {
  const room = await requireSpectator(ctx, args.publicId, args.spectatorSecret);
  return publicRoom(room, sanitizeSpectatorState(room.state as GameState), {
    events: await recentPublicEvents(ctx, room, SPECTATOR_FEED_EVENTS),
    watcherCount: room.status === "active" ? (await onlineWatchers(ctx, room)).length : 0
  });
}

export async function recordSpectatorHeartbeat(
  ctx: MutationCtx,
  args: { publicId: string; spectatorSecret: string; sessionId: string }
) {
  const room = await requireSpectator(ctx, args.publicId, args.spectatorSecret);
  if (room.status !== "active" || !validIdentifier(args.sessionId)) return null;
  const watcherId = `watch_${args.sessionId}`;
  const watchers = await onlineWatchers(ctx, room);
  if (watchers.length >= MAX_ROOM_WATCHERS && !watchers.some((watcher) => watcher.userId === watcherId)) {
    return null;
  }
  await presence.heartbeat(
    ctx,
    watcherPresenceKey(room),
    watcherId,
    watcherId,
    GUEST_PRESENCE_INTERVAL_MS
  );
  return null;
}
