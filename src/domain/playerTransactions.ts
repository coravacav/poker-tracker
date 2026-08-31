import type { Transaction } from "./pokerTypes";

/**
 * Legacy player transfers represented chip gifts. Food transfers used the same
 * arithmetic even though they represented a shared expense, so reverse their
 * endpoints when moving them to the explicit debt transaction type.
 */
export function normalizeLegacyPlayerTransaction(transaction: Transaction): Transaction {
  if (transaction.type !== "player_transfer") {
    return transaction;
  }

  if (transaction.category === "food") {
    return {
      ...transaction,
      type: "player_owes",
      fromPlayerId: transaction.toPlayerId,
      toPlayerId: transaction.fromPlayerId
    };
  }

  return {
    ...transaction,
    type: "player_gave"
  };
}

export function normalizeLegacyPlayerTransactions(transactions: Transaction[]): Transaction[] {
  return transactions.map(normalizeLegacyPlayerTransaction);
}
