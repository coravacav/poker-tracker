// "Players confirm each other": a seated guest proposes an entry and another
// player agrees to it, and the server records it with no host approval.
//
// - give: the proposer gave the counterparty chips (player_gave, proposer to
//   counterparty, settled later). buy: the proposer bought chips from the
//   counterparty (player_gave, counterparty to proposer). Both are confirmed
//   by whoever holds the counterparty seat.
// - bank: the proposer bought in from the bank (bank_buy_in for the proposer).
//   Any other seated guest, or only the named witness when there is one, can
//   say "I saw it"; the host can always witness it.
//
// The proposer's seat always comes from the phone's live claim, never from
// arguments. "Not right" bounces an entry back to its proposer and into the
// host's Needs you, where the host can dismiss it or record it anyway. The
// host also answers for the host's own seat and for seats no phone holds.
// Open proposals expire after AGREEMENT_TTL_MS. Every recorded entry goes
// through commitRoomAction as a server-authored write, so the host's
// in-flight actions still rebase over it.
import type { GameState, Transaction, TransactionConfirmation } from "../../src/domain/pokerTypes";
import { applyHostedAction, MAX_ROOM_ACTIONS } from "../../src/session/roomProtocol";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  cancelRoomAgreements,
  MAX_BOUNCED_AGREEMENTS_PER_GUEST,
  MAX_OPEN_AGREEMENTS_PER_GUEST
} from "./agreementCleanup";
import { validIdentifier } from "./capabilities";
import { creationLimiter } from "./creationLimits";
import { requireGuest, requireHost } from "./roomAccess";
import { commitRoomAction } from "./roomActions";
import { fail } from "./roomErrors";
import {
  agreementPlayerName,
  guestAnswerBlock,
  hostAnswerRole,
  isActiveSeat
} from "./roomAgreementViews";
import { liveHostPlayerId, liveSeatOf, seatClaims } from "./roomSeats";

/** How long a proposal waits for an answer before it expires. */
export const AGREEMENT_TTL_MS = 30 * 60 * 1000;
/** Largest amount one agreed entry can carry ($10,000). */
export const MAX_AGREEMENT_CENTS = 1_000_000;
const MAX_NOTE_LENGTH = 200;
const MAX_BOUNCE_REASON_LENGTH = 200;
const MAX_PLAYER_ID_LENGTH = 200;

export type AgreementKind = Doc<"roomAgreements">["kind"];
type Agreement = Doc<"roomAgreements">;
type ClosedReason = NonNullable<Agreement["closedReason"]>;

/**
 * What a guest or host answer did: the entry's status afterwards, and why it
 * closed. "returned" reads as "bounced", as it does in the views.
 */
export type AgreementResult = {
  status: Exclude<Agreement["status"], "returned">;
  reason: ClosedReason | null;
};

function result(agreement: Pick<Agreement, "status" | "closedReason">): AgreementResult {
  return {
    status: agreement.status === "returned" ? "bounced" : agreement.status,
    reason: agreement.closedReason ?? null
  };
}

function requireActiveRoom(room: Doc<"rooms">) {
  if (room.status !== "active") fail("ROOM_NOT_ACTIVE", "This room is no longer active.");
}

function requirePeerConfirm(room: Doc<"rooms">) {
  if (room.peerConfirm !== true) {
    fail("INVALID_ARGUMENT", "The host records entries in this game. Send the host a request instead.");
  }
}

async function requireAgreement(ctx: MutationCtx, room: Doc<"rooms">, agreementId: Id<"roomAgreements">) {
  const agreement = await ctx.db.get("roomAgreements", agreementId);
  if (!agreement || agreement.roomId !== room._id) fail("INVALID_ARGUMENT", "That entry was not found.");
  return agreement;
}

/** The entry an agreement records, before the server gives it an id and time. */
function agreementTransaction(
  agreement: Pick<
    Agreement,
    "kind" | "amountCents" | "note" | "proposerPlayerId" | "counterpartyPlayerId"
  >,
  agreementId: string,
  confirmation: { confirmedVia: TransactionConfirmation; confirmedByPlayerId?: string },
  nowIso: string
): Transaction {
  const metadata = {
    proposedByPlayerId: agreement.proposerPlayerId,
    agreementId,
    confirmedVia: confirmation.confirmedVia,
    ...(confirmation.confirmedByPlayerId !== undefined
      ? { confirmedByPlayerId: confirmation.confirmedByPlayerId }
      : {}),
    ...(agreement.note !== undefined ? { note: agreement.note } : {})
  };
  // id and createdAt are replaced by the server when the entry is applied.
  const base = { id: "transaction_agreement", createdAt: nowIso, amountCents: agreement.amountCents };
  if (agreement.kind === "bank") {
    return { ...base, ...metadata, type: "bank_buy_in", toPlayerId: agreement.proposerPlayerId };
  }
  const [fromPlayerId, toPlayerId] =
    agreement.kind === "give"
      ? [agreement.proposerPlayerId, agreement.counterpartyPlayerId]
      : [agreement.counterpartyPlayerId, agreement.proposerPlayerId];
  return { ...base, ...metadata, type: "player_gave", category: "poker", fromPlayerId, toPlayerId };
}

function addAction(transaction: Transaction) {
  return { type: "add_transaction" as const, transaction };
}

/** Null when the entry would apply to the room as it is now, else why not. */
function dryRunError(room: Doc<"rooms">, transaction: Transaction): string | null {
  if (room.acceptedActionCount >= MAX_ROOM_ACTIONS) return "This room has reached its action limit.";
  const applied = applyHostedAction(
    room.state as GameState,
    addAction(transaction),
    new Date().toISOString(),
    () => "transaction_agreement_check",
    { trustAgreementMetadata: true }
  );
  return "error" in applied ? applied.error : null;
}

async function close(
  ctx: MutationCtx,
  agreement: Agreement,
  patch: { status: "cancelled"; closedReason: ClosedReason } | { status: "expired" }
): Promise<AgreementResult> {
  await ctx.db.patch(agreement._id, { ...patch, decidedAt: Date.now() });
  return result({ ...agreement, ...patch });
}

/**
 * Closes an open proposal that can no longer be answered: past its expiry, or
 * its proposer no longer holds the seat it was proposed from (revoked, moved,
 * released, or the player changed). Returns null while it still stands.
 */
async function closeIfStale(
  ctx: MutationCtx,
  room: Doc<"rooms">,
  agreement: Agreement
): Promise<AgreementResult | null> {
  if (Date.now() >= agreement.expiresAt) return await close(ctx, agreement, { status: "expired" });
  const proposer = await ctx.db.get("roomGuests", agreement.proposerGuestId);
  if (!proposer || liveSeatOf(room, proposer) !== agreement.proposerPlayerId) {
    return await close(ctx, agreement, { status: "cancelled", closedReason: "seat_lost" });
  }
  return null;
}

/**
 * Records an agreed entry through commitRoomAction (server-authored, so it
 * moves only `version`). If the entry no longer applies to the room, the
 * agreement is cancelled as invalid instead of failing the answer.
 */
async function recordAgreement(
  ctx: MutationCtx,
  room: Doc<"rooms">,
  agreement: Agreement,
  confirmation: { confirmedVia: TransactionConfirmation; confirmedByPlayerId?: string },
  decidedBy: { guestId: Id<"roomGuests"> } | { host: true },
  actorLabel: string
): Promise<AgreementResult> {
  const agreementId = String(agreement._id);
  const transaction = agreementTransaction(agreement, agreementId, confirmation, new Date().toISOString());
  const clientActionId = `agreement_${agreementId}`;
  const processed = await ctx.db
    .query("processedActions")
    .withIndex("by_room_id_and_client_action_id", (index) =>
      index.eq("roomId", room._id).eq("clientActionId", clientActionId)
    )
    .unique();
  if (processed) {
    // Already in the ledger; only the agreement's own status was behind.
    await ctx.db.patch(agreement._id, { status: "recorded", decidedAt: Date.now() });
    return { status: "recorded", reason: null };
  }
  if (dryRunError(room, transaction) !== null) {
    return await close(ctx, agreement, { status: "cancelled", closedReason: "invalid" });
  }
  const { state } = await commitRoomAction(ctx, room, addAction(transaction), {
    actorLabel,
    clientActionId,
    hostAuthored: false,
    trustAgreementMetadata: true
  });
  const recorded = state.transactions.find((candidate) => candidate.agreementId === agreementId);
  await ctx.db.patch(agreement._id, {
    status: "recorded",
    decidedAt: Date.now(),
    ...("guestId" in decidedBy ? { decidedByGuestId: decidedBy.guestId } : { decidedByHost: true }),
    confirmedVia: confirmation.confirmedVia,
    ...(confirmation.confirmedByPlayerId !== undefined
      ? { confirmedByPlayerId: confirmation.confirmedByPlayerId }
      : {}),
    ...(recorded ? { appliedTransactionId: recorded.id } : {})
  });
  return { status: "recorded", reason: null };
}

/** "Maya · confirmed by Jon" / "Priya · seen by Dev", shown under the entry in the feed. */
function agreedLabel(state: GameState, agreement: Agreement, confirmer: string | "host") {
  const verb = agreement.kind === "bank" ? "seen by" : "confirmed by";
  const by = confirmer === "host" ? "the host" : agreementPlayerName(state, confirmer);
  return `${agreementPlayerName(state, agreement.proposerPlayerId)} · ${verb} ${by}`;
}

function validSeatId(playerId: string | undefined): playerId is string {
  return typeof playerId === "string" && playerId.length > 0 && playerId.length <= MAX_PLAYER_ID_LENGTH;
}

export async function proposeRoomAgreement(
  ctx: MutationCtx,
  args: {
    publicId: string;
    guestSecret: string;
    kind: AgreementKind;
    amountCents: number;
    counterpartyPlayerId?: string;
    witnessPlayerId?: string;
    clientRequestId: string;
    note?: string;
  }
) {
  const { room, guest } = await requireGuest(ctx, args.publicId, args.guestSecret);
  requireActiveRoom(room);
  requirePeerConfirm(room);
  if (!validIdentifier(args.clientRequestId)) fail("INVALID_ARGUMENT", "Request identity is invalid.");
  const existing = await ctx.db
    .query("roomAgreements")
    .withIndex("by_proposer_guest_id_and_client_request_id", (index) =>
      index.eq("proposerGuestId", guest._id).eq("clientRequestId", args.clientRequestId)
    )
    .unique();
  if (existing) return existing._id;

  const proposerPlayerId = liveSeatOf(room, guest);
  if (proposerPlayerId === null) fail("INVALID_ARGUMENT", "Pick your seat first.");
  if (
    !Number.isSafeInteger(args.amountCents) ||
    args.amountCents <= 0 ||
    args.amountCents > MAX_AGREEMENT_CENTS
  ) {
    fail("INVALID_ARGUMENT", "Enter an amount between $0.01 and $10,000.");
  }
  if (args.note !== undefined && args.note.length > MAX_NOTE_LENGTH * 2) {
    fail("INVALID_ARGUMENT", "Keep the note under 200 characters.");
  }
  const note = args.note?.trim() || undefined;
  if (note !== undefined && note.length > MAX_NOTE_LENGTH) {
    fail("INVALID_ARGUMENT", "Keep the note under 200 characters.");
  }

  let counterpartyPlayerId: string | undefined;
  let witnessPlayerId: string | undefined;
  if (args.kind === "bank") {
    if (args.counterpartyPlayerId !== undefined) {
      fail("INVALID_ARGUMENT", "A bank buy-in has no other player.");
    }
    if (args.witnessPlayerId !== undefined) {
      if (!validSeatId(args.witnessPlayerId) || !isActiveSeat(room, args.witnessPlayerId)) {
        fail("INVALID_ARGUMENT", "That player is no longer at the table.");
      }
      if (args.witnessPlayerId === proposerPlayerId) {
        fail("INVALID_ARGUMENT", "Pick someone else to see your buy-in.");
      }
      witnessPlayerId = args.witnessPlayerId;
    }
  } else {
    if (args.witnessPlayerId !== undefined) {
      fail("INVALID_ARGUMENT", "Only bank buy-ins name a witness.");
    }
    if (!validSeatId(args.counterpartyPlayerId) || !isActiveSeat(room, args.counterpartyPlayerId)) {
      fail("INVALID_ARGUMENT", "That player is no longer at the table.");
    }
    if (args.counterpartyPlayerId === proposerPlayerId) {
      fail("INVALID_ARGUMENT", "Pick another player.");
    }
    counterpartyPlayerId = args.counterpartyPlayerId;
  }

  const open = await ctx.db
    .query("roomAgreements")
    .withIndex("by_proposer_guest_id_and_status", (index) =>
      index.eq("proposerGuestId", guest._id).eq("status", "open")
    )
    .take(MAX_OPEN_AGREEMENTS_PER_GUEST);
  if (open.length >= MAX_OPEN_AGREEMENTS_PER_GUEST) {
    fail("ROOM_LIMIT_REACHED", "Wait for answers to your open entries first.");
  }
  let bouncedCount = 0;
  for (const status of ["bounced", "returned"] as const) {
    bouncedCount += (await ctx.db
      .query("roomAgreements")
      .withIndex("by_proposer_guest_id_and_status", (index) =>
        index.eq("proposerGuestId", guest._id).eq("status", status)
      )
      .take(MAX_BOUNCED_AGREEMENTS_PER_GUEST)).length;
  }
  if (bouncedCount >= MAX_BOUNCED_AGREEMENTS_PER_GUEST) {
    fail("ROOM_LIMIT_REACHED", "Clear your bounced entries first.");
  }

  const draft = { kind: args.kind, amountCents: args.amountCents, note, proposerPlayerId, counterpartyPlayerId };
  // The entry must apply to the room as it is now (players, amount, limits).
  const checkError = dryRunError(
    room,
    agreementTransaction(draft, "agreement_check", { confirmedVia: "peer" }, new Date().toISOString())
  );
  if (checkError !== null) fail("INVALID_ARGUMENT", checkError);

  // A propose/cancel loop can't flood the room with rows and expiry jobs. A
  // retry with the same request id returned above without using a token.
  const limit = await creationLimiter.limit(ctx, "agreementProposal", { key: guest._id });
  if (!limit.ok) fail("ROOM_LIMIT_REACHED", "You're sending entries quickly. Try again in a few minutes.");

  // Who may answer is fixed now: the phone on the counterparty (or named
  // witness) seat at this moment, on this claim, or the host if none.
  const answerSeat = counterpartyPlayerId ?? witnessPlayerId;
  const holder = answerSeat === undefined ? undefined : (await seatClaims(ctx, room)).get(answerSeat);

  const now = Date.now();
  const agreementId = await ctx.db.insert("roomAgreements", {
    roomId: room._id,
    kind: args.kind,
    amountCents: args.amountCents,
    ...(note !== undefined ? { note } : {}),
    proposerGuestId: guest._id,
    proposerPlayerId,
    ...(counterpartyPlayerId !== undefined ? { counterpartyPlayerId } : {}),
    ...(witnessPlayerId !== undefined ? { witnessPlayerId } : {}),
    ...(holder ? { seatGuestId: holder._id, seatClaimedAt: holder.claimedAt } : {}),
    status: "open",
    clientRequestId: args.clientRequestId,
    createdAt: now,
    expiresAt: now + AGREEMENT_TTL_MS
  });
  await ctx.scheduler.runAfter(AGREEMENT_TTL_MS, internal.rooms.expireAgreement, { agreementId });
  return agreementId;
}

/** Why this guest can't answer an open agreement (see guestAnswerBlock), or null. */
function guestAnswerError(
  state: GameState,
  agreement: Agreement,
  guest: Doc<"roomGuests">,
  seat: string | null
): string | null {
  const name = (playerId: string | undefined) => agreementPlayerName(state, playerId);
  switch (guestAnswerBlock(agreement, guest, seat)) {
    case null:
      return null;
    case "own":
      return "You can't confirm your own entry.";
    case "no_seat":
      return "Pick your seat first.";
    case "not_counterparty":
      return `Only ${name(agreement.counterpartyPlayerId)} can confirm this.`;
    case "own_buy_in":
      return "You can't confirm your own buy-in.";
    case "not_witness":
      return `${name(agreement.proposerPlayerId)} asked ${name(agreement.witnessPlayerId)} to see this.`;
    case "host_answers":
      return "No phone was in this seat when it was sent, so the host answers for it.";
    case "claimed_later":
      return "You took your seat after this was sent, so the host answers for it.";
  }
}

/** A guest's answer: "confirm" (Confirm / I saw it) or "not_right" (Not right / I didn't see it). */
export async function answerRoomAgreement(
  ctx: MutationCtx,
  args: {
    publicId: string;
    guestSecret: string;
    agreementId: Id<"roomAgreements">;
    answer: "confirm" | "not_right";
    reason?: string;
  }
): Promise<AgreementResult> {
  const { room, guest } = await requireGuest(ctx, args.publicId, args.guestSecret);
  requireActiveRoom(room);
  requirePeerConfirm(room);
  const agreement = await requireAgreement(ctx, room, args.agreementId);
  // Already answered (a double tap, or two phones at once): nothing changes.
  if (agreement.status !== "open") return result(agreement);
  const state = room.state as GameState;
  const seat = liveSeatOf(room, guest);
  const refusal = guestAnswerError(state, agreement, guest, seat);
  if (refusal !== null) fail("INVALID_ARGUMENT", refusal);
  const stale = await closeIfStale(ctx, room, agreement);
  if (stale) return stale;

  if (args.answer === "not_right") {
    const bounceReason = args.reason?.trim().slice(0, MAX_BOUNCE_REASON_LENGTH) || undefined;
    await ctx.db.patch(agreement._id, {
      status: "bounced",
      decidedAt: Date.now(),
      decidedByGuestId: guest._id,
      ...(bounceReason !== undefined ? { bounceReason } : {})
    });
    return { status: "bounced", reason: null };
  }
  return await recordAgreement(
    ctx,
    room,
    agreement,
    { confirmedVia: "peer", confirmedByPlayerId: seat! },
    { guestId: guest._id },
    agreedLabel(state, agreement, seat!)
  );
}

/** The proposer takes back an open proposal. */
export async function cancelOwnRoomAgreement(
  ctx: MutationCtx,
  args: { publicId: string; guestSecret: string; agreementId: Id<"roomAgreements"> }
): Promise<AgreementResult> {
  const { room, guest } = await requireGuest(ctx, args.publicId, args.guestSecret);
  const agreement = await requireAgreement(ctx, room, args.agreementId);
  if (agreement.proposerGuestId !== guest._id) fail("INVALID_ARGUMENT", "Only the player who sent this can cancel it.");
  if (agreement.status !== "open") return result(agreement);
  return await close(ctx, agreement, { status: "cancelled", closedReason: "proposer" });
}

/** The proposer clears a bounced entry (after fixing and resending it, or letting it go). */
export async function dismissOwnRoomAgreement(
  ctx: MutationCtx,
  args: { publicId: string; guestSecret: string; agreementId: Id<"roomAgreements"> }
): Promise<AgreementResult> {
  const { room, guest } = await requireGuest(ctx, args.publicId, args.guestSecret);
  const agreement = await requireAgreement(ctx, room, args.agreementId);
  if (agreement.proposerGuestId !== guest._id) fail("INVALID_ARGUMENT", "Only the player who sent this can dismiss it.");
  if (agreement.status !== "bounced" && agreement.status !== "returned") return result(agreement);
  await ctx.db.patch(agreement._id, { status: "dismissed" });
  return { status: "dismissed", reason: null };
}

async function requireHostController(
  ctx: MutationCtx,
  args: { publicId: string; hostSecret: string; controllerId: string }
) {
  const room = await requireHost(ctx, args.publicId, args.hostSecret);
  requireActiveRoom(room);
  if (room.hostControllerId !== args.controllerId) {
    fail("DUPLICATE_CONTROLLER", "Another tab controls this hosted room.");
  }
  return room;
}

/** The host answers for their own seat, a seat with no phone, or any bank buy-in. */
export async function hostAnswerRoomAgreement(
  ctx: MutationCtx,
  args: {
    publicId: string;
    hostSecret: string;
    controllerId: string;
    agreementId: Id<"roomAgreements">;
    answer: "confirm" | "not_right";
  }
): Promise<AgreementResult> {
  const room = await requireHostController(ctx, args);
  requirePeerConfirm(room);
  const agreement = await requireAgreement(ctx, room, args.agreementId);
  if (agreement.status !== "open") return result(agreement);
  const state = room.state as GameState;
  const role = hostAnswerRole(room, agreement);
  if (role === null) {
    fail(
      "INVALID_ARGUMENT",
      isActiveSeat(room, agreement.counterpartyPlayerId)
        ? `${agreementPlayerName(state, agreement.counterpartyPlayerId)}'s phone answers for that seat.`
        : "That player is no longer at the table."
    );
  }
  const stale = await closeIfStale(ctx, room, agreement);
  if (stale) return stale;

  if (args.answer === "not_right") {
    // The host already decided, so it goes back to the proposer only.
    await ctx.db.patch(agreement._id, { status: "returned", decidedAt: Date.now(), decidedByHost: true });
    return { status: "bounced", reason: null };
  }
  const hostSeat = liveHostPlayerId(room);
  const asSelf = role === "self" && hostSeat !== null;
  return await recordAgreement(
    ctx,
    room,
    agreement,
    asSelf ? { confirmedVia: "peer", confirmedByPlayerId: hostSeat } : { confirmedVia: "host" },
    { host: true },
    agreedLabel(state, agreement, asSelf ? hostSeat : "host")
  );
}

/**
 * The host settles a bounced entry: dismiss it (back to the proposer only),
 * or record it anyway. Both stay available after "Players confirm each
 * other" is turned off: they are the host's own decision, like approving a
 * guest request.
 */
export async function hostResolveBouncedRoomAgreement(
  ctx: MutationCtx,
  args: {
    publicId: string;
    hostSecret: string;
    controllerId: string;
    agreementId: Id<"roomAgreements">;
    decision: "dismiss" | "record";
  }
): Promise<AgreementResult> {
  const room = await requireHostController(ctx, args);
  const agreement = await requireAgreement(ctx, room, args.agreementId);
  if (agreement.status !== "bounced") return result(agreement);
  if (args.decision === "dismiss") {
    // It leaves the host's list and stays bounced for the proposer, who can
    // resend or dismiss it.
    await ctx.db.patch(agreement._id, { status: "returned", hostDismissedAt: Date.now() });
    return { status: "bounced", reason: null };
  }
  const state = room.state as GameState;
  return await recordAgreement(
    ctx,
    room,
    agreement,
    { confirmedVia: "host" },
    { host: true },
    `${agreementPlayerName(state, agreement.proposerPlayerId)} · recorded by the host`
  );
}

/** Host: turns "Players confirm each other" on or off; off cancels open proposals. */
export async function setRoomPeerConfirm(
  ctx: MutationCtx,
  args: { publicId: string; hostSecret: string; controllerId: string; on: boolean }
) {
  const room = await requireHostController(ctx, args);
  await ctx.db.patch(room._id, { peerConfirm: args.on, lastActivityAt: Date.now() });
  if (!args.on) await cancelRoomAgreements(ctx, room._id, "peer_confirm_off");
  return null;
}

/** Scheduled AGREEMENT_TTL_MS after a proposal: expires it if nobody answered. */
export async function expireRoomAgreement(
  ctx: MutationCtx,
  args: { agreementId: Id<"roomAgreements"> }
) {
  const agreement = await ctx.db.get("roomAgreements", args.agreementId);
  if (!agreement || agreement.status !== "open") return null;
  const remaining = agreement.expiresAt - Date.now();
  if (remaining > 0) {
    await ctx.scheduler.runAfter(remaining, internal.rooms.expireAgreement, args);
    return null;
  }
  await ctx.db.patch(agreement._id, { status: "expired", decidedAt: Date.now() });
  return null;
}

/** Closes a room's open and bounced agreements once it is no longer active (lifecycle expiry). */
export async function closeInactiveRoomAgreements(ctx: MutationCtx, args: { roomId: Id<"rooms"> }) {
  const room = await ctx.db.get("rooms", args.roomId);
  if (!room || room.status === "active") return null;
  await cancelRoomAgreements(ctx, room._id, "ended", { includeBounced: true });
  return null;
}
