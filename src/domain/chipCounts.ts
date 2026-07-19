import type {
  BankSummary,
  CashOutDraft,
  ChipCountLine,
  ChipDenomination,
  Player,
  PlayerId,
  Transaction
} from "./pokerTypes";

export type ChipCountAggregate = ChipDenomination & {
  count: number;
  totalCents: number;
};

export type CashOutOverview = {
  completedPlayerIds: Set<PlayerId>;
  missingPlayers: Player[];
  manualFinalPlayerIds: Set<PlayerId>;
  recordedTotalCents: number;
  projectedTotalCents: number;
  projectedRemainingCents: number;
  aggregates: ChipCountAggregate[];
};

function transactionTimestamp(transaction: Transaction): number {
  const timestamp = Date.parse(transaction.createdAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function affectsPlayerChipStack(transaction: Transaction, playerId: PlayerId): boolean {
  if (transaction.voidedAt) return false;
  if (transaction.type === "bank_buy_in") return transaction.toPlayerId === playerId;
  if (transaction.type === "bank_cash_out") return transaction.fromPlayerId === playerId;
  if (transaction.type === "player_transfer" && transaction.category !== "food") {
    return transaction.fromPlayerId === playerId || transaction.toPlayerId === playerId;
  }
  return false;
}

export function latestChipStackTransactionForPlayer(
  transactions: Transaction[],
  playerId: PlayerId
): Transaction | undefined {
  let latest: { transaction: Transaction; index: number } | undefined;

  for (const [index, transaction] of transactions.entries()) {
    if (!affectsPlayerChipStack(transaction, playerId)) continue;
    if (!latest) {
      latest = { transaction, index };
      continue;
    }

    const timestampDifference =
      transactionTimestamp(transaction) - transactionTimestamp(latest.transaction);
    if (timestampDifference > 0 || (timestampDifference === 0 && index > latest.index)) {
      latest = { transaction, index };
    }
  }

  return latest?.transaction;
}

export function currentFinalCashOutForPlayer(
  transactions: Transaction[],
  playerId: PlayerId
): Transaction | undefined {
  const latest = latestChipStackTransactionForPlayer(transactions, playerId);
  return latest?.type === "bank_cash_out" && latest.cashOutKind === "final"
    ? latest
    : undefined;
}

export function isPlayerCashOutComplete(
  transactions: Transaction[],
  playerId: PlayerId
): boolean {
  return currentFinalCashOutForPlayer(transactions, playerId) !== undefined;
}

export function chipCountLineTotalCents(line: ChipCountLine): number {
  return line.valueCents * line.count;
}

export function chipCountTotalCents(lines: ChipCountLine[]): number {
  return lines.reduce((total, line) => total + chipCountLineTotalCents(line), 0);
}

export function mergeChipCountLines(
  denominations: ChipDenomination[],
  storedLines: ChipCountLine[]
): ChipCountLine[] {
  const storedById = new Map(storedLines.map((line) => [line.denominationId, line]));
  const currentIds = new Set(denominations.map((denomination) => denomination.id));
  const currentLines = denominations.map((denomination) => ({
    denominationId: denomination.id,
    label: denomination.label,
    colorHex: denomination.colorHex,
    valueCents: denomination.valueCents,
    count: storedById.get(denomination.id)?.count ?? 0
  }));
  const removedLines = storedLines.filter(
    (line) => !currentIds.has(line.denominationId) && line.count > 0
  );

  return [...currentLines, ...removedLines];
}

export function snapshotNonzeroChipCountLines(lines: ChipCountLine[]): ChipCountLine[] {
  return lines
    .filter((line) => line.count > 0)
    .map((line) => ({ ...line }));
}

export function activeCashOutsForPlayer(
  transactions: Transaction[],
  playerId: PlayerId
): Transaction[] {
  return transactions.filter(
    (transaction) =>
      transaction.type === "bank_cash_out" &&
      transaction.fromPlayerId === playerId &&
      !transaction.voidedAt
  );
}

export function getCashOutOverview(
  players: Player[],
  transactions: Transaction[],
  drafts: CashOutDraft[],
  denominations: ChipDenomination[],
  bankSummary: BankSummary
): CashOutOverview {
  const activeCashOuts = transactions.filter(
    (transaction) => transaction.type === "bank_cash_out" && !transaction.voidedAt
  );
  const cashOutsByPlayer = new Map<PlayerId, Transaction[]>();
  for (const transaction of activeCashOuts) {
    if (!transaction.fromPlayerId) continue;
    const current = cashOutsByPlayer.get(transaction.fromPlayerId) ?? [];
    current.push(transaction);
    cashOutsByPlayer.set(transaction.fromPlayerId, current);
  }

  const draftByPlayer = new Map(drafts.map((draft) => [draft.playerId, draft]));
  const completedPlayerIds = new Set<PlayerId>();
  const manualFinalPlayerIds = new Set<PlayerId>();
  const effectiveLines: ChipCountLine[] = [];

  let recordedTotalCents = 0;
  for (const transaction of activeCashOuts) recordedTotalCents += transaction.amountCents;
  let projectedTotalCents = recordedTotalCents;

  for (const player of players) {
    const playerCashOuts = cashOutsByPlayer.get(player.id) ?? [];
    const currentFinalCashOut = currentFinalCashOutForPlayer(transactions, player.id);
    const draft = draftByPlayer.get(player.id);
    if (currentFinalCashOut) completedPlayerIds.add(player.id);
    if (currentFinalCashOut && currentFinalCashOut.chipCountBreakdown === undefined) {
      manualFinalPlayerIds.add(player.id);
    }

    if (draft?.correctingTransactionId) {
      const original =
        currentFinalCashOut?.id === draft.correctingTransactionId
          ? currentFinalCashOut
          : undefined;
      if (original) {
        for (const transaction of playerCashOuts) {
          if (transaction.id !== original.id && transaction.chipCountBreakdown) {
            effectiveLines.push(...transaction.chipCountBreakdown);
          }
        }
        const merged = mergeChipCountLines(denominations, draft.lines);
        projectedTotalCents += chipCountTotalCents(merged) - original.amountCents;
        effectiveLines.push(...snapshotNonzeroChipCountLines(merged));
        continue;
      }
    }

    for (const transaction of playerCashOuts) {
      if (transaction.chipCountBreakdown) {
        effectiveLines.push(...transaction.chipCountBreakdown);
      }
    }

    if (!currentFinalCashOut && draft && !draft.correctingTransactionId) {
      const merged = mergeChipCountLines(denominations, draft.lines);
      projectedTotalCents += chipCountTotalCents(merged);
      effectiveLines.push(...snapshotNonzeroChipCountLines(merged));
    }
  }

  const aggregateBySnapshot = new Map<string, ChipCountAggregate>();
  for (const line of effectiveLines) {
    const key = [
      line.denominationId,
      line.label,
      line.colorHex.toLowerCase(),
      line.valueCents
    ].join(":");
    const existing = aggregateBySnapshot.get(key);
    if (existing) {
      existing.count += line.count;
      existing.totalCents += chipCountLineTotalCents(line);
    } else {
      aggregateBySnapshot.set(key, {
        id: line.denominationId,
        label: line.label,
        colorHex: line.colorHex,
        valueCents: line.valueCents,
        count: line.count,
        totalCents: chipCountLineTotalCents(line)
      });
    }
  }

  return {
    completedPlayerIds,
    missingPlayers: players.filter((player) => !completedPlayerIds.has(player.id)),
    manualFinalPlayerIds,
    recordedTotalCents,
    projectedTotalCents,
    projectedRemainingCents:
      bankSummary.balanceCents - (projectedTotalCents - recordedTotalCents),
    aggregates: [...aggregateBySnapshot.values()]
  };
}
