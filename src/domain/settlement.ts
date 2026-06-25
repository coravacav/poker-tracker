import type {
  Player,
  PlayerLedgerSummary,
  SettlementPayment
} from "./pokerTypes";

export function buildMinimizedSettlement(
  summaries: PlayerLedgerSummary[]
): SettlementPayment[] {
  const debtors = summaries
    .filter((summary) => summary.netCents < 0)
    .map((summary) => ({
      playerId: summary.playerId,
      remainingCents: Math.abs(summary.netCents)
    }))
    .sort((a, b) => b.remainingCents - a.remainingCents);

  const creditors = summaries
    .filter((summary) => summary.netCents > 0)
    .map((summary) => ({
      playerId: summary.playerId,
      remainingCents: summary.netCents
    }))
    .sort((a, b) => b.remainingCents - a.remainingCents);

  const payments: SettlementPayment[] = [];
  let debtorIndex = 0;
  let creditorIndex = 0;

  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const amountCents = Math.min(debtor.remainingCents, creditor.remainingCents);

    if (amountCents > 0) {
      payments.push({
        fromPlayerId: debtor.playerId,
        toPlayerId: creditor.playerId,
        amountCents
      });
    }

    debtor.remainingCents -= amountCents;
    creditor.remainingCents -= amountCents;

    if (debtor.remainingCents === 0) {
      debtorIndex += 1;
    }

    if (creditor.remainingCents === 0) {
      creditorIndex += 1;
    }
  }

  return payments;
}

export function filterSettlementSummariesForDisplay(
  players: Player[],
  summaries: PlayerLedgerSummary[]
): PlayerLedgerSummary[] {
  const activePlayerIds = new Set(
    players.filter((player) => player.isActive).map((player) => player.id)
  );

  return summaries.filter(
    (summary) => activePlayerIds.has(summary.playerId) || summary.netCents !== 0
  );
}

export function playerNameById(players: Player[], playerId: string): string {
  return players.find((player) => player.id === playerId)?.name ?? "Unknown player";
}
