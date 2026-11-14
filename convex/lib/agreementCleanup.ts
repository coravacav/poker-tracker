// Closing agreements (convex/lib/roomAgreements.ts) when the room or a
// proposer's standing changes: ending the room, revoking a guest, a guest
// losing or moving seats, and turning "Players confirm each other" off. Kept
// apart from roomAgreements.ts so seat and guest code can call it without an
// import cycle.
import { MAX_ROOM_GUESTS } from "../../src/session/roomProtocol";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/** Open proposals one guest may have waiting at a time. */
export const MAX_OPEN_AGREEMENTS_PER_GUEST = 10;
/** Bounced proposals one guest may leave undismissed before proposing again. */
export const MAX_BOUNCED_AGREEMENTS_PER_GUEST = 10;
/** Open (or bounced) agreements a room can hold across all of its guests. */
export const MAX_ROOM_AGREEMENTS_PER_STATUS = MAX_ROOM_GUESTS * MAX_OPEN_AGREEMENTS_PER_GUEST;

type ClosedReason = NonNullable<Doc<"roomAgreements">["closedReason"]>;

async function cancelRows(
  ctx: MutationCtx,
  rows: Doc<"roomAgreements">[],
  reason: ClosedReason,
  now: number
) {
  for (const agreement of rows) {
    await ctx.db.patch(agreement._id, { status: "cancelled", closedReason: reason, decidedAt: now });
  }
}

/**
 * Cancels one guest's open proposals (and, with `includeBounced`, the bounced
 * ones still waiting on the host), e.g. when they lose their seat or are
 * revoked: a proposal is only ever made from the seat its phone holds.
 */
export async function cancelGuestAgreements(
  ctx: MutationCtx,
  guestId: Id<"roomGuests">,
  reason: ClosedReason,
  options: { includeBounced?: boolean } = {}
) {
  const now = Date.now();
  const statuses = options.includeBounced ? (["open", "bounced"] as const) : (["open"] as const);
  for (const status of statuses) {
    const rows = await ctx.db
      .query("roomAgreements")
      .withIndex("by_proposer_guest_id_and_status", (index) =>
        index.eq("proposerGuestId", guestId).eq("status", status)
      )
      .take(
        status === "open" ? MAX_OPEN_AGREEMENTS_PER_GUEST * 2 : MAX_BOUNCED_AGREEMENTS_PER_GUEST * 2
      );
    await cancelRows(ctx, rows, reason, now);
  }
}

/** Cancels every open agreement in the room (and bounced ones with `includeBounced`). */
export async function cancelRoomAgreements(
  ctx: MutationCtx,
  roomId: Id<"rooms">,
  reason: ClosedReason,
  options: { includeBounced?: boolean } = {}
) {
  const now = Date.now();
  const statuses = options.includeBounced ? (["open", "bounced"] as const) : (["open"] as const);
  for (const status of statuses) {
    const rows = await ctx.db
      .query("roomAgreements")
      .withIndex("by_room_id_and_status_and_kind", (index) =>
        index.eq("roomId", roomId).eq("status", status)
      )
      .take(MAX_ROOM_AGREEMENTS_PER_STATUS * 2);
    await cancelRows(ctx, rows, reason, now);
  }
}
