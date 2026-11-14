import type { AgreementResult, AgreementStatus, RoomAgreement } from "../../session/types";

type Format = (cents: number) => string;

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A player's name, or "you" when it is the viewer's own seat. */
function who(playerId: string | null, name: string | null, viewerId: string | null): string {
  if (playerId !== null && playerId === viewerId) return "you";
  return name ?? "another player";
}

/** An open entry nobody answered in time; the server marks it expired shortly after. */
export function isExpired(agreement: RoomAgreement, nowMs: number): boolean {
  return agreement.status === "open" && nowMs >= agreement.expiresAt;
}

/** "Jon gave you $20 in chips", "You bought $10 in chips from Dev", "Priya bought $50 in chips from the bank". */
export function agreementSentence(agreement: RoomAgreement, viewerId: string | null, format: Format): string {
  const proposer = who(agreement.proposerPlayerId, agreement.proposerName, viewerId);
  const other = who(agreement.counterpartyPlayerId, agreement.counterpartyName, viewerId);
  const amount = format(agreement.amountCents);
  if (agreement.kind === "give") return capitalize(`${proposer} gave ${other} ${amount} in chips`);
  if (agreement.kind === "buy") return capitalize(`${proposer} bought ${amount} in chips from ${other}`);
  return capitalize(`${proposer} bought ${amount} in chips from the bank`);
}

/**
 * Who owes whom once the entry is recorded: "You'll owe Jon $20 at settle-up."
 * Null for a bank buy-in, which nobody owes another player for.
 */
export function settleUpLine(
  debtor: { id: string | null; name: string | null },
  creditor: { id: string | null; name: string | null },
  amount: string,
  viewerId: string | null
): string {
  if (debtor.id !== null && debtor.id === viewerId) {
    return `You'll owe ${creditor.name ?? "them"} ${amount} at settle-up.`;
  }
  if (creditor.id !== null && creditor.id === viewerId) {
    return `${debtor.name ?? "They"} will owe you ${amount} at settle-up.`;
  }
  return `${debtor.name ?? "They"} will owe ${creditor.name ?? "them"} ${amount} at settle-up.`;
}

export function agreementSettleLine(
  agreement: RoomAgreement,
  viewerId: string | null,
  format: Format
): string | null {
  if (agreement.kind === "bank") return null;
  const proposer = { id: agreement.proposerPlayerId, name: agreement.proposerName };
  const other = { id: agreement.counterpartyPlayerId, name: agreement.counterpartyName };
  // give: the proposer gave chips, so the other player owes them; buy: the other way round.
  return agreement.kind === "give"
    ? settleUpLine(other, proposer, format(agreement.amountCents), viewerId)
    : settleUpLine(proposer, other, format(agreement.amountCents), viewerId);
}

/** Who turned a bounced entry back: "Dev said not right", "The host didn't see it". */
export function bouncedByLine(agreement: RoomAgreement, viewerId: string | null): string {
  const byHost = agreement.bouncedByHost;
  if (agreement.kind === "bank") {
    const name = byHost ? "The host" : capitalize(who(agreement.witnessPlayerId, agreement.witnessName ?? "A player", viewerId));
    return `${name} didn't see it`;
  }
  const name = byHost ? "The host" : capitalize(who(agreement.counterpartyPlayerId, agreement.counterpartyName, viewerId));
  return `${name} said not right`;
}

/** Who an open entry is waiting on: "waiting on Sam", "waiting for a witness". */
export function waitingOnLine(agreement: RoomAgreement): string {
  if (agreement.kind === "bank") {
    return agreement.witnessName ? `waiting on ${agreement.witnessName}` : "waiting for a witness";
  }
  return `waiting on ${agreement.counterpartyName ?? "the other player"}`;
}

/** How a recorded entry was agreed: "confirmed by Jon", "you saw it", "voided by the host". */
export function confirmedLine(agreement: RoomAgreement, viewerId: string | null): string {
  if (agreement.voided) return "voided by the host";
  const bank = agreement.kind === "bank";
  if (agreement.confirmedVia === "host" && agreement.confirmedByPlayerId === null) {
    return bank ? "seen by the host" : "confirmed by the host";
  }
  if (agreement.confirmedByPlayerId !== null && agreement.confirmedByPlayerId === viewerId) {
    return bank ? "you saw it" : "you confirmed";
  }
  const name = agreement.confirmedByName ?? (agreement.confirmedVia === "host" ? "the host" : "another player");
  return bank ? `seen by ${name}` : `confirmed by ${name}`;
}

export function agreementTime(createdAt: number): string {
  return new Date(createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/**
 * A short note when an answer, cancel, or dismiss found the entry already
 * closed (another phone answered first, it expired, the host ended the game),
 * or null when it did what was asked.
 */
export function closedNotice(result: AgreementResult, expected: AgreementStatus): string | null {
  if (result.status === expected) return null;
  switch (result.status) {
    case "recorded":
      return "Someone already confirmed that one.";
    case "bounced":
      return "Someone already said that one wasn't right.";
    case "expired":
      return "That entry expired before anyone answered.";
    case "dismissed":
      return "That entry was already cleared.";
    case "open":
      return "That entry is still waiting for an answer.";
    case "cancelled":
      switch (result.reason) {
        case "proposer":
          return "That entry was cancelled.";
        case "ended":
          return "The host ended the game, so that entry was cancelled.";
        case "peer_confirm_off":
          return "The host turned off players confirming each other.";
        case "invalid":
          return "That entry no longer fits the game, so it was cancelled.";
        default:
          return "That entry was cancelled after a seat changed.";
      }
  }
}
