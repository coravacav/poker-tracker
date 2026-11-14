import type { PlayerId, Transaction, TransactionType } from "./pokerTypes";

/**
 * Who proposed and who confirmed an entry players agreed on in a shared room.
 * Only the room server writes these fields; anything a client submits is
 * stripped (see session/roomProtocol.ts).
 */
export const AGREEMENT_METADATA_KEYS = [
  "proposedByPlayerId",
  "confirmedByPlayerId",
  "agreementId",
  "confirmedVia"
] as const;

const MAX_AGREEMENT_ID_LENGTH = 160;
const AGREEMENT_TRANSACTION_TYPES = new Set<TransactionType>(["player_gave", "bank_buy_in"]);

export function hasAgreementMetadata(transaction: Transaction): boolean {
  return AGREEMENT_METADATA_KEYS.some((key) => transaction[key] !== undefined);
}

export function withoutAgreementMetadata(transaction: Transaction): Transaction {
  if (!AGREEMENT_METADATA_KEYS.some((key) => key in transaction)) return transaction;
  const {
    proposedByPlayerId: _proposedByPlayerId,
    confirmedByPlayerId: _confirmedByPlayerId,
    agreementId: _agreementId,
    confirmedVia: _confirmedVia,
    ...rest
  } = transaction;
  return rest;
}

/** Null when the transaction has no agreement metadata or all of it is usable. */
export function agreementMetadataError(
  transaction: Transaction,
  playerIds: ReadonlySet<PlayerId>
): string | null {
  if (!hasAgreementMetadata(transaction)) return null;
  if (!AGREEMENT_TRANSACTION_TYPES.has(transaction.type)) {
    return "Agreement details are only valid for player gifts and buy-ins.";
  }
  const { proposedByPlayerId, confirmedByPlayerId, agreementId, confirmedVia } = transaction;
  if (
    proposedByPlayerId !== undefined &&
    (typeof proposedByPlayerId !== "string" || !playerIds.has(proposedByPlayerId))
  ) {
    return "The proposing player does not exist.";
  }
  if (confirmedByPlayerId !== undefined) {
    if (typeof confirmedByPlayerId !== "string" || !playerIds.has(confirmedByPlayerId)) {
      return "The confirming player does not exist.";
    }
    if (confirmedByPlayerId === proposedByPlayerId) {
      return "A player cannot confirm their own entry.";
    }
  }
  if (
    agreementId !== undefined &&
    (typeof agreementId !== "string" ||
      agreementId.length < 1 ||
      agreementId.length > MAX_AGREEMENT_ID_LENGTH)
  ) {
    return "The agreement reference is invalid.";
  }
  if (confirmedVia !== undefined && confirmedVia !== "peer" && confirmedVia !== "host") {
    return "Choose how the entry was confirmed.";
  }
  return null;
}

/**
 * Keeps agreement metadata only when all of it is usable; otherwise the entry
 * loads without it (the money itself is unaffected), so a save is never
 * rejected over these optional fields.
 */
export function withUsableAgreementMetadata(
  transaction: Transaction,
  playerIds: ReadonlySet<PlayerId>
): Transaction {
  if (!hasAgreementMetadata(transaction)) return withoutAgreementMetadata(transaction);
  return agreementMetadataError(transaction, playerIds) === null
    ? transaction
    : withoutAgreementMetadata(transaction);
}
