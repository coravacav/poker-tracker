// What guests and the host see of agreements (convex/lib/roomAgreements.ts):
// a guest's Inbox buckets and the host's Needs you. Every read is indexed and
// bounded by the per-guest caps in agreementCleanup.ts.
import type { GameState } from "../../src/domain/pokerTypes";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { MAX_ROOM_AGREEMENTS_PER_STATUS } from "./agreementCleanup";
import { activeSeatPlayers, liveHostPlayerId, liveSeatOf } from "./roomSeats";

/** Recorded entries a guest's Done list shows. */
const RECENT_DONE_AGREEMENTS = 10;
/** Entries the host's Needs you lists per section. */
const HOST_NEEDS_LIMIT = 50;

type Agreement = Doc<"roomAgreements">;
type Ctx = QueryCtx | MutationCtx;

export function isActiveSeat(room: Doc<"rooms">, playerId: string | undefined) {
  return playerId !== undefined && activeSeatPlayers(room).some((player) => player.id === playerId);
}

export function agreementPlayerName(state: GameState, playerId: string | undefined): string {
  const player = playerId === undefined ? undefined : state.players.find((candidate) => candidate.id === playerId);
  return player?.name.trim().slice(0, 40) || "Player";
}

/**
 * How the host may answer an open agreement, or null: "self" as the host's
 * own seat (the counterparty, or for bank the host's seat as witness), "seat"
 * for a counterparty seat that had no phone when it was proposed (even if a
 * phone has claimed it since), or "bank" for any bank buy-in when the host
 * has no seat of their own.
 */
export function hostAnswerRole(room: Doc<"rooms">, agreement: Agreement): "self" | "seat" | "bank" | null {
  const hostSeat = liveHostPlayerId(room);
  if (agreement.kind === "bank") {
    return hostSeat !== null && hostSeat !== agreement.proposerPlayerId ? "self" : "bank";
  }
  if (!isActiveSeat(room, agreement.counterpartyPlayerId)) return null;
  if (agreement.counterpartyPlayerId === hostSeat) return "self";
  return agreement.seatGuestId === undefined ? "seat" : null;
}

/** The same claim that held a seat when the agreement was proposed. */
function heldSinceProposal(agreement: Agreement, guest: Doc<"roomGuests">) {
  return agreement.seatGuestId === guest._id && guest.claimedAt === agreement.seatClaimedAt;
}

export type GuestAnswerBlock =
  | "own"
  | "no_seat"
  | "not_counterparty"
  | "own_buy_in"
  | "not_witness"
  | "host_answers"
  | "claimed_later";

/**
 * Why this guest can't answer (Confirm / I saw it, or Not right) an open
 * agreement, or null when they can. Give/buy: the phone that held the
 * counterparty seat when it was proposed, on that same claim. Bank: the
 * named witness's phone on the same terms, or with no named witness any
 * other seated phone whose claim predates the proposal. The proposer's own
 * phone never can, and a seat that had no phone at proposal is the host's.
 */
export function guestAnswerBlock(
  agreement: Agreement,
  guest: Doc<"roomGuests">,
  seat: string | null
): GuestAnswerBlock | null {
  if (agreement.proposerGuestId === guest._id) return "own";
  if (seat === null) return "no_seat";
  if (agreement.kind !== "bank") {
    if (agreement.counterpartyPlayerId !== seat) return "not_counterparty";
  } else {
    if (seat === agreement.proposerPlayerId) return "own_buy_in";
    if (agreement.witnessPlayerId === undefined) {
      return guest.claimedAt !== undefined && guest.claimedAt <= agreement.createdAt
        ? null
        : "claimed_later";
    }
    if (agreement.witnessPlayerId !== seat) return "not_witness";
  }
  if (agreement.seatGuestId === undefined) return "host_answers";
  return heldSinceProposal(agreement, guest) ? null : "claimed_later";
}

export function agreementView(state: GameState, agreement: Agreement) {
  const name = (playerId: string | undefined) =>
    playerId === undefined ? null : agreementPlayerName(state, playerId);
  const transaction = agreement.appliedTransactionId === undefined
    ? undefined
    : state.transactions.find((candidate) => candidate.id === agreement.appliedTransactionId);
  return {
    id: agreement._id,
    kind: agreement.kind,
    amountCents: agreement.amountCents,
    note: agreement.note ?? null,
    proposerPlayerId: agreement.proposerPlayerId,
    proposerName: agreementPlayerName(state, agreement.proposerPlayerId),
    counterpartyPlayerId: agreement.counterpartyPlayerId ?? null,
    counterpartyName: name(agreement.counterpartyPlayerId),
    witnessPlayerId: agreement.witnessPlayerId ?? null,
    witnessName: name(agreement.witnessPlayerId),
    // The other seat had no phone when it was sent (or is the host's), so the host answers.
    hostAnswers: agreement.kind !== "bank" && agreement.seatGuestId === undefined,
    // Returned entries read as bounced: back with the proposer either way.
    status: agreement.status === "returned" ? ("bounced" as const) : agreement.status,
    closedReason: agreement.closedReason ?? null,
    bounceReason: agreement.bounceReason ?? null,
    bouncedByHost: agreement.status === "returned" && agreement.decidedByHost === true,
    createdAt: agreement.createdAt,
    expiresAt: agreement.expiresAt,
    decidedAt: agreement.decidedAt ?? null,
    confirmedByPlayerId: agreement.confirmedByPlayerId ?? null,
    confirmedByName: name(agreement.confirmedByPlayerId),
    confirmedVia: agreement.confirmedVia ?? null,
    transactionId: agreement.appliedTransactionId ?? null,
    voided: transaction?.voidedAt !== undefined
  };
}

function oldestFirst(left: Agreement, right: Agreement) {
  return left.createdAt - right.createdAt || left._creationTime - right._creationTime;
}

function newestFirst(left: Agreement, right: Agreement) {
  return (
    (right.decidedAt ?? right.createdAt) - (left.decidedAt ?? left.createdAt) ||
    right._creationTime - left._creationTime
  );
}

/**
 * A guest's Inbox: entries waiting on them (open give/buy to their seat, open
 * bank buy-ins they may witness), their own open and bounced proposals, and
 * the latest recorded entries involving them.
 */
export async function guestAgreements(ctx: Ctx, room: Doc<"rooms">, guest: Doc<"roomGuests">) {
  const state = room.state as GameState;
  const seat = liveSeatOf(room, guest);
  const needsMe: Agreement[] = [];
  if (seat !== null) {
    const toMySeat = await ctx.db
      .query("roomAgreements")
      .withIndex("by_room_id_and_status_and_counterparty_player_id", (index) =>
        index.eq("roomId", room._id).eq("status", "open").eq("counterpartyPlayerId", seat)
      )
      .take(MAX_ROOM_AGREEMENTS_PER_STATUS);
    const bank = await ctx.db
      .query("roomAgreements")
      .withIndex("by_room_id_and_status_and_kind", (index) =>
        index.eq("roomId", room._id).eq("status", "open").eq("kind", "bank")
      )
      .take(MAX_ROOM_AGREEMENTS_PER_STATUS);
    needsMe.push(
      ...[...toMySeat, ...bank].filter((agreement) => guestAnswerBlock(agreement, guest, seat) === null)
    );
  }
  const mine = (status: "open" | "bounced" | "returned" | "recorded", limit: number) =>
    ctx.db
      .query("roomAgreements")
      .withIndex("by_proposer_guest_id_and_status", (index) =>
        index.eq("proposerGuestId", guest._id).eq("status", status)
      )
      .order("desc")
      .take(limit);
  const open = await mine("open", MAX_ROOM_AGREEMENTS_PER_STATUS);
  const bounced = [
    ...(await mine("bounced", MAX_ROOM_AGREEMENTS_PER_STATUS)),
    ...(await mine("returned", MAX_ROOM_AGREEMENTS_PER_STATUS))
  ].sort(newestFirst);
  const done = new Map<string, Agreement>();
  const recordedSources = [
    await mine("recorded", RECENT_DONE_AGREEMENTS),
    await ctx.db
      .query("roomAgreements")
      .withIndex("by_decided_by_guest_id_and_status", (index) =>
        index.eq("decidedByGuestId", guest._id).eq("status", "recorded")
      )
      .order("desc")
      .take(RECENT_DONE_AGREEMENTS),
    seat === null
      ? []
      : await ctx.db
          .query("roomAgreements")
          .withIndex("by_room_id_and_status_and_counterparty_player_id", (index) =>
            index.eq("roomId", room._id).eq("status", "recorded").eq("counterpartyPlayerId", seat)
          )
          .order("desc")
          .take(RECENT_DONE_AGREEMENTS)
  ];
  for (const agreement of recordedSources.flat()) done.set(String(agreement._id), agreement);
  const view = (agreement: Agreement) => agreementView(state, agreement);
  return {
    needsMe: needsMe.sort(oldestFirst).map(view),
    mine: open.map(view),
    bounced: bounced.map(view),
    recentDone: [...done.values()].sort(newestFirst).slice(0, RECENT_DONE_AGREEMENTS).map(view)
  };
}

/**
 * The host's Needs you: open entries the host may answer (with how), oldest
 * first, and the newest entries a player said weren't right, awaiting Dismiss
 * or Record anyway. Entries the host turned back or dismissed are "returned"
 * and stay with their proposer only.
 */
export async function hostAgreements(ctx: Ctx, room: Doc<"rooms">) {
  const state = room.state as GameState;
  const open = await ctx.db
    .query("roomAgreements")
    .withIndex("by_room_id_and_status_and_decided_at", (index) =>
      index.eq("roomId", room._id).eq("status", "open")
    )
    .take(MAX_ROOM_AGREEMENTS_PER_STATUS);
  const answer = open
    .flatMap((agreement) => {
      const answerAs = hostAnswerRole(room, agreement);
      return answerAs === null ? [] : [{ agreement, answerAs }];
    })
    .sort((left, right) => oldestFirst(left.agreement, right.agreement))
    .slice(0, HOST_NEEDS_LIMIT)
    .map(({ agreement, answerAs }) => ({ ...agreementView(state, agreement), answerAs }));
  const bounced = (await ctx.db
    .query("roomAgreements")
    .withIndex("by_room_id_and_status_and_decided_at", (index) =>
      index.eq("roomId", room._id).eq("status", "bounced")
    )
    .order("desc")
    .take(HOST_NEEDS_LIMIT))
    .map((agreement) => agreementView(state, agreement));
  return { answer, bounced };
}
