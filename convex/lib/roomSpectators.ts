// The read-only watch link: the host turns it on, rotates, or turns it off;
// spectators see a sanitized table and the recent feed, and count as watchers
// through their own presence key. A watch secret never joins, previews an
// invitation, or sends requests: it is checked only by requireSpectator.
import type { GameState } from "../../src/domain/pokerTypes";
import { sanitizeSpectatorState } from "../../src/session/roomProtocol";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { hashSecret, sameHash, validIdentifier, validSecret } from "./capabilities";
import { creationLimiter } from "./creationLimits";
import { requireHost, requireSpectator } from "./roomAccess";
import { fail } from "./roomErrors";
import { recentPublicEvents } from "./roomNotifications";
import {
  GUEST_PRESENCE_INTERVAL_MS,
  MAX_ROOM_WATCHERS,
  onlineWatchers,
  presence,
  removeWatcherPresenceBatch,
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
  // A leaked link can always be turned off, even after the game ends (ended
  // rooms stay watchable until pruned); a new link needs an active room.
  if (room.status !== "active" && args.spectatorSecret !== null) {
    fail("ROOM_NOT_ACTIVE", "This room is no longer active.");
  }
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
  await ctx.db.patch(room._id, {
    spectatorSecretHash,
    ...(room.status === "active" ? { lastActivityAt: Date.now() } : {})
  });
  // Watchers of the old link are gone; the new link counts from zero under
  // its own key, and the old key's rows are removed in the background.
  await scheduleWatcherPresenceCleanup(ctx, room);
  return null;
}

/** Schedules removal of the presence rows of the room's current watch link, if any. */
export async function scheduleWatcherPresenceCleanup(
  ctx: MutationCtx,
  room: Pick<Doc<"rooms">, "publicId" | "spectatorSecretHash">
) {
  if (room.spectatorSecretHash === undefined) return;
  await ctx.scheduler.runAfter(0, internal.rooms.removeWatcherPresence, {
    presenceKey: watcherPresenceKey(room.publicId, room.spectatorSecretHash)
  });
}

/** One cleanup batch; schedules the next until the key is empty. */
export async function removeWatcherPresence(ctx: MutationCtx, args: { presenceKey: string }) {
  if (!/^[A-Za-z0-9_-]{16,160}:watch:[0-9a-f]{16}$/.test(args.presenceKey)) return null;
  if (!(await removeWatcherPresenceBatch(ctx, args.presenceKey))) {
    await ctx.scheduler.runAfter(0, internal.rooms.removeWatcherPresence, args);
  }
  return null;
}

export async function spectatorRoomView(
  ctx: QueryCtx,
  args: { publicId: string; spectatorSecret: string }
) {
  const room = await requireSpectator(ctx, args.publicId, args.spectatorSecret);
  return publicRoom(room, sanitizeSpectatorState(room.state as GameState), {
    // No watcher count here: presence changes would re-send the whole room
    // to every watcher. The count is for the host view only.
    events: await recentPublicEvents(ctx, room, SPECTATOR_FEED_EVENTS)
  });
}

export async function recordSpectatorHeartbeat(
  ctx: MutationCtx,
  args: { publicId: string; spectatorSecret: string; sessionId: string }
) {
  const room = await requireSpectator(ctx, args.publicId, args.spectatorSecret);
  if (room.status !== "active" || !validIdentifier(args.sessionId)) return null;
  const watcherId = `watch_${args.sessionId}`;
  const presenceKey = watcherPresenceKey(room.publicId, room.spectatorSecretHash!);
  // Watcher ids are picked by the client, so new ones are bounded twice: at
  // most MAX_ROOM_WATCHERS online at once, and a per-room rate of new ids, so
  // the rows a link accumulates stay bounded until it is cleaned up.
  const known = (await presence.listUser(ctx, watcherId, false, 8)).some(
    (entry) => entry.roomId === presenceKey
  );
  if (!known) {
    const watchers = await onlineWatchers(ctx, room);
    if (watchers.length >= MAX_ROOM_WATCHERS) return null;
    const allowed = await creationLimiter.limit(ctx, "newRoomWatcher", { key: room._id });
    if (!allowed.ok) return null;
  }
  await presence.heartbeat(ctx, presenceKey, watcherId, watcherId, GUEST_PRESENCE_INTERVAL_MS);
  return null;
}
