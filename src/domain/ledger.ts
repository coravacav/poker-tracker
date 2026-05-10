import type {
  BankSummary,
  Player,
  PlayerId,
  PlayerLedgerSummary,
  Transaction
} from "./pokerTypes";

export function getActiveTransactions(transactions: Transaction[]): Transaction[] {
  return transactions.filter((transaction) => !transaction.voidedAt);
}

export function hasPlayerTransactions(playerId: PlayerId, transactions: Transaction[]): boolean {
  return transactions.some(
    (transaction) =>
      transaction.fromPlayerId === playerId || transaction.toPlayerId === playerId
  );
}

export function buildPlayerSummaries(
  players: Player[],
  transactions: Transaction[]
): PlayerLedgerSummary[] {
  const summaries = new Map<PlayerId, PlayerLedgerSummary>();

  for (const player of players) {
    summaries.set(player.id, {
      playerId: player.id,
      bankBuyInsCents: 0,
      bankCashOutsCents: 0,
      sentToPlayersCents: 0,
      receivedFromPlayersCents: 0,
      netCents: 0
    });
  }

  for (const transaction of getActiveTransactions(transactions)) {
    if (transaction.type === "bank_buy_in" && transaction.toPlayerId) {
      const summary = summaries.get(transaction.toPlayerId);
      if (summary) {
        summary.bankBuyInsCents += transaction.amountCents;
      }
    }

    if (transaction.type === "bank_cash_out" && transaction.fromPlayerId) {
      const summary = summaries.get(transaction.fromPlayerId);
      if (summary) {
        summary.bankCashOutsCents += transaction.amountCents;
      }
    }

    if (transaction.type === "player_transfer") {
      if (transaction.fromPlayerId) {
        const fromSummary = summaries.get(transaction.fromPlayerId);
        if (fromSummary) {
          fromSummary.sentToPlayersCents += transaction.amountCents;
        }
      }

      if (transaction.toPlayerId) {
        const toSummary = summaries.get(transaction.toPlayerId);
        if (toSummary) {
          toSummary.receivedFromPlayersCents += transaction.amountCents;
        }
      }
    }
  }

  return [...summaries.values()].map((summary) => ({
    ...summary,
    netCents:
      summary.bankCashOutsCents +
      summary.sentToPlayersCents -
      summary.bankBuyInsCents -
      summary.receivedFromPlayersCents
  }));
}

export function getSummaryByPlayerId(
  summaries: PlayerLedgerSummary[]
): Map<PlayerId, PlayerLedgerSummary> {
  return new Map(summaries.map((summary) => [summary.playerId, summary]));
}

export function calculateBankSummary(transactions: Transaction[]): BankSummary {
  return getActiveTransactions(transactions).reduce<BankSummary>(
    (summary, transaction) => {
      if (transaction.type === "bank_buy_in") {
        summary.incomingCents += transaction.amountCents;
      }

      if (transaction.type === "bank_cash_out") {
        summary.outgoingCents += transaction.amountCents;
      }

      if (transaction.type === "manual_bank_adjustment") {
        if (transaction.bankDirection === "outgoing") {
          summary.outgoingCents += transaction.amountCents;
        } else {
          summary.incomingCents += transaction.amountCents;
        }
      }

      summary.balanceCents = summary.incomingCents - summary.outgoingCents;
      return summary;
    },
    {
      incomingCents: 0,
      outgoingCents: 0,
      balanceCents: 0
    }
  );
}

export function calculateLedgerImbalanceCents(
  playerSummaries: PlayerLedgerSummary[],
  bankSummary: BankSummary
): number {
  const playersTotal = playerSummaries.reduce(
    (total, summary) => total + summary.netCents,
    0
  );

  return playersTotal + bankSummary.balanceCents;
}
