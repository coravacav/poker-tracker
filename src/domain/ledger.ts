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

/** When the first readable transaction (the first buy-in) happened, or null before any. */
export function firstTransactionAtMs(transactions: Transaction[]): number | null {
  let earliest = Number.POSITIVE_INFINITY;
  for (const transaction of transactions) {
    const ms = Date.parse(transaction.createdAt);
    if (Number.isFinite(ms) && ms < earliest) earliest = ms;
  }
  return earliest === Number.POSITIVE_INFINITY ? null : earliest;
}

export function hasPlayerTransactions(playerId: PlayerId, transactions: Transaction[]): boolean {
  return transactions.some(
    (transaction) =>
      transaction.fromPlayerId === playerId ||
      transaction.toPlayerId === playerId ||
      transaction.coveredByPlayerId === playerId ||
      transaction.coveredPlayerId === playerId
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
      owedToPlayersCents: 0,
      owedByPlayersCents: 0,
      debtCoveredByOthersCents: 0,
      debtCoveredForOthersCents: 0,
      netCents: 0
    });
  }

  for (const transaction of getActiveTransactions(transactions)) {
    if (transaction.type === "bank_buy_in" && transaction.toPlayerId) {
      const summary = summaries.get(
        transaction.coveredByPlayerId ?? transaction.toPlayerId
      );
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

    if (transaction.type === "player_gave" || transaction.type === "player_transfer") {
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

    if (
      transaction.type === "player_owes" &&
      transaction.fromPlayerId &&
      transaction.toPlayerId
    ) {
      const owingSummary = summaries.get(transaction.fromPlayerId);
      const owedSummary = summaries.get(transaction.toPlayerId);

      if (owingSummary) {
        owingSummary.owedToPlayersCents += transaction.amountCents;
      }

      if (owedSummary) {
        owedSummary.owedByPlayersCents += transaction.amountCents;
      }
    }

    if (
      transaction.type === "debt_coverage" &&
      transaction.coveredPlayerId &&
      transaction.coveredByPlayerId
    ) {
      const coveredSummary = summaries.get(transaction.coveredPlayerId);
      const covererSummary = summaries.get(transaction.coveredByPlayerId);

      if (coveredSummary) {
        coveredSummary.debtCoveredByOthersCents += transaction.amountCents;
      }

      if (covererSummary) {
        covererSummary.debtCoveredForOthersCents += transaction.amountCents;
      }
    }
  }

  return [...summaries.values()].map((summary) => ({
    ...summary,
    netCents:
      summary.bankCashOutsCents +
      summary.sentToPlayersCents -
      summary.bankBuyInsCents -
      summary.receivedFromPlayersCents +
      summary.owedByPlayersCents -
      summary.owedToPlayersCents +
      summary.debtCoveredByOthersCents -
      summary.debtCoveredForOthersCents
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

/** One kind of chip move a player made, totalled per other player. */
export type PlayerChipMove = {
  /** bank: bought in from the bank; covered: a bank buy-in someone else paid for; got / gave: chips from or to a player. */
  kind: "bank" | "covered" | "got" | "gave";
  amountCents: number;
  /** The other player (for covered, who paid). */
  otherPlayerId?: PlayerId;
};

/**
 * A player's chip moves as plain facts, totalled per kind and other player in
 * the order they first happened: bank buy-ins, covered buy-ins, and chips
 * given to or taken from other players. Voided entries are left out; debts and
 * cash-outs aren't chip moves between players.
 */
export function playerChipMoves(playerId: PlayerId, transactions: Transaction[]): PlayerChipMove[] {
  const moves = new Map<string, PlayerChipMove>();
  const add = (kind: PlayerChipMove["kind"], amountCents: number, otherPlayerId?: PlayerId) => {
    const key = `${kind}:${otherPlayerId ?? ""}`;
    const move = moves.get(key);
    if (move) move.amountCents += amountCents;
    else moves.set(key, { kind, amountCents, ...(otherPlayerId ? { otherPlayerId } : {}) });
  };
  for (const transaction of getActiveTransactions(transactions)) {
    if (transaction.type === "bank_buy_in" && transaction.toPlayerId === playerId) {
      const payer = transaction.coveredByPlayerId;
      if (payer && payer !== playerId) add("covered", transaction.amountCents, payer);
      else add("bank", transaction.amountCents);
    } else if (transaction.type === "player_gave" || transaction.type === "player_transfer") {
      const { fromPlayerId, toPlayerId } = transaction;
      if (!fromPlayerId || !toPlayerId || fromPlayerId === toPlayerId) continue;
      if (toPlayerId === playerId) add("got", transaction.amountCents, fromPlayerId);
      else if (fromPlayerId === playerId) add("gave", transaction.amountCents, toPlayerId);
    }
  }
  return [...moves.values()];
}
