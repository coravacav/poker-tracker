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
/**
 * Bounced proposals one guest may leave undismissed before proposing again.
 * Each bounce comes from an open proposal, so a guest never has more than
 * this plus MAX_OPEN_AGREEMENTS_PER_GUEST bounced at once.
 */
export const MAX_BOUNCED_AGREEMENTS_PER_GUEST = 10;
/** Open (or bounced) agreements a room can hold across all of its guests. */
export const MAX_ROOM_AGREEMENTS_PER_STATUS = MAX_ROOM_GUESTS * MAX_OPEN_AGREEMENTS_PER_GUEST;

type ClosedReason = NonNullable<Doc<"roomAgreements">["closedReason"]>;

/** Open, plus (with includeBounced) bounced and returned entries. */
function statusesFor(options: { includeBounced?: boolean }) {
  return options.includeBounced
    ? (["open", "bounced", "returned"] as const)
    : (["open"] as const);
}

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
  for (const status of statusesFor(options)) {
    const rows = await ctx.db
      .query("roomAgreements")
      .withIndex("by_proposer_guest_id_and_status", (index) =>
        index.eq("proposerGuestId", guestId).eq("status", status)
      )
      .take(MAX_OPEN_AGREEMENTS_PER_GUEST + MAX_BOUNCED_AGREEMENTS_PER_GUEST);
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
  for (const status of statusesFor(options)) {
    const rows = await ctx.db
      .query("roomAgreements")
      .withIndex("by_room_id_and_status_and_kind", (index) =>
        index.eq("roomId", roomId).eq("status", status)
      )
      .take(MAX_ROOM_AGREEMENTS_PER_STATUS * 2);
    await cancelRows(ctx, rows, reason, now);
  }
}

/**
 * Cancels open agreements aimed at a seat (as the other player or the named
 * witness) when that seat loses its phone or its player changes: whoever
 * answers next would not be the person the proposer asked. With `heldBy`,
 * only entries that phone was asked to answer (it held the seat when they
 * were sent); entries sent while the seat had no phone stay with the host.
 */
export async function cancelSeatAgreements(
  ctx: MutationCtx,
  roomId: Id<"rooms">,
  playerId: string,
  options: { heldBy?: Id<"roomGuests"> } = {}
) {
  const now = Date.now();
  const aimed = await ctx.db
    .query("roomAgreements")
    .withIndex("by_room_id_and_status_and_counterparty_player_id", (index) =>
      index.eq("roomId", roomId).eq("status", "open").eq("counterpartyPlayerId", playerId)
    )
    .take(MAX_ROOM_AGREEMENTS_PER_STATUS);
  const witnessed = await ctx.db
    .query("roomAgreements")
    .withIndex("by_room_id_and_status_and_witness_player_id", (index) =>
      index.eq("roomId", roomId).eq("status", "open").eq("witnessPlayerId", playerId)
    )
    .take(MAX_ROOM_AGREEMENTS_PER_STATUS);
  const rows = [...aimed, ...witnessed].filter(
    (agreement) => options.heldBy === undefined || agreement.seatGuestId === options.heldBy
  );
  await cancelRows(ctx, rows, "counterparty_seat_lost", now);
}
