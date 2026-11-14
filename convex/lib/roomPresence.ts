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

/** Watchers have their own presence key, so they never count as (or crowd out) guests. */
export function watcherPresenceKey(room: Pick<Doc<"rooms">, "publicId">) {
  return `${room.publicId}:watch`;
}

export async function onlineWatchers(ctx: QueryCtx | MutationCtx, room: Pick<Doc<"rooms">, "publicId">) {
  return await presence.listRoom(ctx, watcherPresenceKey(room), true, MAX_ROOM_WATCHERS);
}
