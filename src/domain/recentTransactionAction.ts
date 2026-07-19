import type { Transaction } from "./pokerTypes";

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
