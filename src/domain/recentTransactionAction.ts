import type { Player, Transaction } from "./pokerTypes";

export const RECENT_TRANSACTION_UNDO_WINDOW_MS = 30_000;

export type RecentTransactionAction = {
  kind: "create" | "void";
  transactionId: string;
  occurredAt: string;
};

type ActionCandidate = RecentTransactionAction & {
  occurredAtMs: number;
  transactionIndex: number;
};

function parsedTimestamp(value: string): number | null {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isLaterCandidate(candidate: ActionCandidate, current: ActionCandidate): boolean {
  if (candidate.occurredAtMs !== current.occurredAtMs) {
    return candidate.occurredAtMs > current.occurredAtMs;
  }

  if (candidate.transactionIndex !== current.transactionIndex) {
    return candidate.transactionIndex > current.transactionIndex;
  }

  return candidate.kind === "void" && current.kind === "create";
}

export function getLatestTransactionAction(
  transactions: Transaction[]
): RecentTransactionAction | null {
  const transactionById = new Map(transactions.map((transaction) => [transaction.id, transaction]));
  const linkedOriginalIds = new Set<string>();
  const candidates: ActionCandidate[] = [];

  for (const [transactionIndex, transaction] of transactions.entries()) {
    const createdAtMs = parsedTimestamp(transaction.createdAt);
    if (createdAtMs === null) {
      return null;
    }

    const flippedOriginalId = transaction.flippedFromTransactionId;
    const correctedOriginalId = transaction.correctsTransactionId;
    if (flippedOriginalId && correctedOriginalId) {
      return null;
    }

    let actionAt = transaction.createdAt;
    let actionAtMs = createdAtMs;
    const originalId = flippedOriginalId ?? correctedOriginalId;

    if (originalId) {
      const original = transactionById.get(originalId);
      const expectedReason = flippedOriginalId
        ? "Flipped transaction"
        : "Corrected chip count";
      const originalVoidedAtMs = original?.voidedAt
        ? parsedTimestamp(original.voidedAt)
        : null;

      if (
        !original ||
        original.voidReason !== expectedReason ||
        originalVoidedAtMs === null ||
        linkedOriginalIds.has(original.id)
      ) {
        return null;
      }

      linkedOriginalIds.add(original.id);
      if (originalVoidedAtMs > actionAtMs) {
        actionAt = original.voidedAt!;
        actionAtMs = originalVoidedAtMs;
      }
    }

    candidates.push({
      kind: "create",
      transactionId: transaction.id,
      occurredAt: actionAt,
      occurredAtMs: actionAtMs,
      transactionIndex
    });

    if (transaction.voidedAt) {
      const voidedAtMs = parsedTimestamp(transaction.voidedAt);
      if (voidedAtMs === null) {
        return null;
      }

      candidates.push({
        kind: "void",
        transactionId: transaction.id,
        occurredAt: transaction.voidedAt,
        occurredAtMs: voidedAtMs,
        transactionIndex
      });
    }
  }

  const standaloneCandidates = candidates.filter(
    (candidate) => candidate.kind !== "void" || !linkedOriginalIds.has(candidate.transactionId)
  );
  const latest = standaloneCandidates.reduce<ActionCandidate | null>(
    (current, candidate) =>
      !current || isLaterCandidate(candidate, current) ? candidate : current,
    null
  );

  return latest
    ? {
        kind: latest.kind,
        transactionId: latest.transactionId,
        occurredAt: latest.occurredAt
      }
    : null;
}

export function isRecentTransactionAction(
  action: RecentTransactionAction,
  nowMs: number
): boolean {
  const occurredAtMs = parsedTimestamp(action.occurredAt);
  if (occurredAtMs === null || !Number.isFinite(nowMs)) {
    return false;
  }

  const ageMs = nowMs - occurredAtMs;
  return ageMs >= 0 && ageMs < RECENT_TRANSACTION_UNDO_WINDOW_MS;
}

/** A short sentence naming what Undo would reverse, such as "Casey rebought $20.00". */
export function describeRecentTransactionAction(
  action: RecentTransactionAction,
  transactions: Transaction[],
  players: Player[],
  formatAmount: (cents: number) => string
): string | null {
  const transaction = transactions.find((candidate) => candidate.id === action.transactionId);
  if (!transaction) {
    return null;
  }

  const nameOf = (playerId: string | undefined) =>
    players.find((player) => player.id === playerId)?.name ?? "A player";
  const amount = formatAmount(transaction.amountCents);
  let description: string;
  switch (transaction.type) {
    case "bank_buy_in":
      description = `${nameOf(transaction.fromPlayerId ?? transaction.toPlayerId)} bought in ${amount}`;
      break;
    case "bank_cash_out":
      description = `${nameOf(transaction.toPlayerId ?? transaction.fromPlayerId)} cashed out ${amount}`;
      break;
    case "player_gave":
    case "player_owes":
    case "player_transfer":
      description = `${nameOf(transaction.fromPlayerId)} → ${nameOf(transaction.toPlayerId)} ${amount}`;
      break;
    case "debt_coverage":
      description = `${nameOf(transaction.coveredByPlayerId)} covered ${nameOf(transaction.coveredPlayerId)} ${amount}`;
      break;
    default:
      description = `Bank adjustment ${amount}`;
  }

  return action.kind === "void" ? `Removed: ${description}` : description;
}
