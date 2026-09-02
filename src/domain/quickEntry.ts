import type { Transaction } from "./pokerTypes";

export function latestRepeatableTransaction(
  transactions: Transaction[]
): Transaction | null {
  return [...transactions]
    .reverse()
    .find((transaction) =>
      !transaction.voidedAt &&
      !transaction.correctsTransactionId &&
      (
        transaction.type === "bank_buy_in" ||
        transaction.type === "player_gave" ||
        transaction.type === "player_owes" ||
        (transaction.type === "bank_cash_out" && transaction.cashOutKind === "partial")
      )
    ) ?? null;
}

export function repeatTransaction(
  transaction: Transaction,
  id: string,
  createdAt: string
): Transaction {
  return {
    ...transaction,
    id,
    createdAt,
    note: transaction.note ? `Repeat: ${transaction.note}` : "Repeated transaction",
    flippedFromTransactionId: undefined,
    correctsTransactionId: undefined,
    voidedAt: undefined,
    voidReason: undefined
  };
}
