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

/**
 * What to ask before "Add default buy-in to all" once anyone has bought in: a second
 * tap gives every player another buy-in, and Undo takes back only the last of them.
 * Null while nobody has bought in, so the opening round goes in with one tap.
 */
export function buyInToAllConfirmation(
  playerIds: string[],
  transactions: Transaction[],
  amountCents: number,
  formatAmount: (cents: number) => string
): string | null {
  const boughtIn = new Set(
    transactions
      .filter((transaction) => transaction.type === "bank_buy_in" && !transaction.voidedAt)
      .map((transaction) => transaction.toPlayerId)
  );
  const alreadyIn = playerIds.filter((playerId) => boughtIn.has(playerId)).length;
  if (alreadyIn === 0) return null;

  const who = alreadyIn === playerIds.length
    ? "Everyone has"
    : `${alreadyIn} of ${playerIds.length} players have`;
  const forWhom = playerIds.length > 1
    ? ` for all ${playerIds.length} (${formatAmount(amountCents * playerIds.length)} in all)`
    : "";
  return `${who} already bought in. Add a ${formatAmount(amountCents)} buy-in${forWhom}? Undo takes back only the last one.`;
}
