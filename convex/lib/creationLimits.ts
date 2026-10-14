// Abuse bounds for unauthenticated document creation. There are no accounts
// and Convex does not expose client IPs, so the limits are global token
// buckets plus a stricter per-friend-profile bucket. All limits are evaluated
// inside the calling mutation's transaction: a rejected or failed creation
// rolls back the tokens it consumed.
import { HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import type { Id } from "../_generated/dataModel";
import { components } from "../_generated/api";
import type { MutationCtx } from "../_generated/server";

export const creationLimiter = new RateLimiter(components.rateLimiter, {
  // Profiles are created once per device and are never deleted, so this is
  // the tightest global bucket: a burst of 20 covers a whole table setting up
  // at once, and 30/hour sustained (720/day) caps how fast storage can grow.
  friendProfileCreation: { kind: "token bucket", rate: 30, period: HOUR, capacity: 20 },
  // Normal use is a handful of rooms per game night across all hosts. A burst
  // of 30 and 60/hour sustained is far above that while bounding a scripted
  // flood to about one room per minute.
  roomCreation: { kind: "token bucket", rate: 60, period: HOUR, capacity: 30 },
  // A single host rarely starts more than one or two rooms in an evening.
  // Five back-to-back, then one every ten minutes, keeps a leaked profile
  // capability from flooding followers' discovery lists.
  profileRoomCreation: { kind: "token bucket", rate: 6, period: HOUR, capacity: 5 }
});

/**
 * Upper bound on concurrently active rooms. Abandoned rooms stay active for up
 * to seven days, so this is sized well above a week of normal hosting while
 * capping the live rooms (and their reactive subscriptions) a flood can hold.
 */
export const MAX_ACTIVE_ROOMS = 300;

const ACTIVE_ROOMS_COUNTER = "activeRooms";

async function activeRoomsCounter(ctx: MutationCtx) {
  return await ctx.db
    .query("roomCounters")
    .withIndex("by_name", (index) => index.eq("name", ACTIVE_ROOMS_COUNTER))
    .unique();
}

/**
 * Claims an active-room slot. Returns false when the cap is reached. The
 * counter is a single small document, so the check is O(1) regardless of how
 * many rooms exist; callers must mark the room `countedActive`.
 */
export async function reserveActiveRoomSlot(ctx: MutationCtx): Promise<boolean> {
  const counter = await activeRoomsCounter(ctx);
  const current = counter?.value ?? 0;
  if (current >= MAX_ACTIVE_ROOMS) return false;
  if (counter) {
    await ctx.db.patch(counter._id, { value: current + 1 });
  } else {
    await ctx.db.insert("roomCounters", { name: ACTIVE_ROOMS_COUNTER, value: 1 });
  }
  return true;
}

/**
 * Releases the slot held by a room leaving the active state. Rooms created
 * before the counter existed never held a slot and are ignored.
 */
export async function releaseActiveRoomSlot(
  ctx: MutationCtx,
  room: { _id: Id<"rooms">; countedActive?: boolean }
) {
  if (room.countedActive !== true) return;
  await ctx.db.patch(room._id, { countedActive: false });
  const counter = await activeRoomsCounter(ctx);
  if (counter && counter.value > 0) {
    await ctx.db.patch(counter._id, { value: counter.value - 1 });
  }
}
