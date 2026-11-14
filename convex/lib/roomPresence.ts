import { Presence } from "@convex-dev/presence";
import { components } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export const presence = new Presence(components.presence);

// The presence component expires a session after 2.5x this value. Guests still
// send every 30 seconds, leaving a five-minute grace period for mobile sleep.
export const GUEST_PRESENCE_INTERVAL_MS = 2 * 60 * 1000;

/** Watchers counted per room; heartbeats from further new watchers are ignored. */
export const MAX_ROOM_WATCHERS = 100;
/** Watcher presence rows one cleanup batch removes before scheduling the next. */
export const WATCHER_CLEANUP_BATCH = 64;

/**
 * Short public id for one generation of the watch link (a prefix of its
 * verifier). The host view carries it so a host tab can tell whether the
 * secret it holds is still the current link.
 */
export function watchLinkId(spectatorSecretHash: string): string {
  return spectatorSecretHash.slice(0, 16);
}

/**
 * Watchers have their own presence key, so they never count as (or crowd out)
 * guests. Each generation of the link gets its own key: rotating or turning it
 * off simply stops using the old key, and its rows are removed in batches.
 */
export function watcherPresenceKey(publicId: string, spectatorSecretHash: string) {
  return `${publicId}:watch:${watchLinkId(spectatorSecretHash)}`;
}

/** Online watchers of the room's current watch link (none while it is off). */
export async function onlineWatchers(
  ctx: QueryCtx | MutationCtx,
  room: Pick<Doc<"rooms">, "publicId" | "spectatorSecretHash">
) {
  if (room.spectatorSecretHash === undefined) return [];
  return await presence.listRoom(
    ctx,
    watcherPresenceKey(room.publicId, room.spectatorSecretHash),
    true,
    MAX_ROOM_WATCHERS
  );
}

/**
 * Removes one batch of a watch-link generation's presence rows, online or not.
 * Returns true once the key is empty (its room token removed too).
 */
export async function removeWatcherPresenceBatch(ctx: MutationCtx, presenceKey: string) {
  const rows = await presence.listRoom(ctx, presenceKey, false, WATCHER_CLEANUP_BATCH);
  for (const row of rows) {
    await presence.removeRoomUser(ctx, presenceKey, row.userId);
  }
  if (rows.length === WATCHER_CLEANUP_BATCH) return false;
  // Nothing (or only a stray session) is left, so this is a small read.
  await presence.removeRoom(ctx, presenceKey);
  return true;
}
