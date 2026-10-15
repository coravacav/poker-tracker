import {
  normalizeLegacyPlayerTransaction,
  normalizeLegacyPlayerTransactions
} from "../../domain/playerTransactions";
import type { GameState, Transaction } from "../../domain/pokerTypes";
import {
  getLatestTransactionAction,
  isRecentTransactionAction
} from "../../domain/recentTransactionAction";
import type { RecentTransactionAction } from "../../domain/recentTransactionAction";
import { createId } from "../seedGame";
import type { TransactionAction } from "../gameActions";

function withoutVoid(transaction: Transaction): Transaction {
  const { voidedAt: _voidedAt, voidReason: _voidReason, ...activeTransaction } = transaction;
  return activeTransaction;
}

function sameRecentAction(
  left: RecentTransactionAction | null,
  right: RecentTransactionAction
): boolean {
  return (
    left?.kind === right.kind &&
    left.transactionId === right.transactionId &&
    left.occurredAt === right.occurredAt
  );
}

export function reduceTransactionAction(state: GameState, action: TransactionAction): GameState {
  switch (action.type) {
    case "add_transaction":
      return {
        ...state,
        transactions: [
          ...state.transactions,
          normalizeLegacyPlayerTransaction(action.transaction)
        ]
      };

    case "add_transactions":
      return {
        ...state,
        transactions: [
          ...state.transactions,
          ...normalizeLegacyPlayerTransactions(action.transactions)
        ]
      };

    case "flip_transaction": {
      const original = state.transactions.find(
        (transaction) => transaction.id === action.transactionId
      );

      if (!original || original.voidedAt || original.type === "debt_coverage") {
        return state;
      }

      const flippedBase: Transaction = {
        ...original,
        id: createId("transaction"),
        createdAt: new Date().toISOString(),
        flippedFromTransactionId: original.id,
        voidedAt: undefined,
        voidReason: undefined
      };

      let flippedTransaction: Transaction | null = null;

      if (
        original.type === "player_gave" ||
        original.type === "player_owes" ||
        original.type === "player_transfer"
      ) {
        if (!original.fromPlayerId || !original.toPlayerId) {
          return state;
        }

        flippedTransaction = {
          ...flippedBase,
          fromPlayerId: original.toPlayerId,
          toPlayerId: original.fromPlayerId
        };
      }

      if (original.type === "bank_buy_in") {
        if (!original.toPlayerId) {
          return state;
        }

        flippedTransaction = {
          ...flippedBase,
          type: "bank_cash_out",
          fromPlayerId: original.toPlayerId,
          toPlayerId: undefined,
          bankDirection: undefined,
          category: undefined,
          coveredByPlayerId: undefined,
          coveredPlayerId: undefined,
          chipCountBreakdown: undefined,
          cashOutKind: "partial",
          correctsTransactionId: undefined
        };
      }

      if (original.type === "bank_cash_out") {
        if (!original.fromPlayerId) {
          return state;
        }

        flippedTransaction = {
          ...flippedBase,
          type: "bank_buy_in",
          fromPlayerId: undefined,
          toPlayerId: original.fromPlayerId,
          bankDirection: undefined,
          category: undefined,
          coveredByPlayerId: undefined,
          coveredPlayerId: undefined,
          chipCountBreakdown: undefined,
          cashOutKind: undefined,
          correctsTransactionId: undefined
        };
      }

      if (original.type === "manual_bank_adjustment") {
        flippedTransaction = {
          ...flippedBase,
          bankDirection: original.bankDirection === "outgoing" ? "incoming" : "outgoing",
          fromPlayerId: undefined,
          toPlayerId: undefined,
          category: undefined,
          coveredByPlayerId: undefined,
          coveredPlayerId: undefined
        };
      }

      if (!flippedTransaction) {
        return state;
      }

      return {
        ...state,
        transactions: [
          ...state.transactions.map((transaction) =>
            transaction.id === original.id
              ? {
                  ...transaction,
                  voidedAt: new Date().toISOString(),
                  voidReason: "Flipped transaction"
                }
              : transaction
          ),
          flippedTransaction
        ]
      };
    }

    case "void_transaction":
      return {
        ...state,
        transactions: state.transactions.map((transaction) =>
          transaction.id === action.transactionId && !transaction.voidedAt
            ? {
                ...transaction,
                voidedAt: new Date().toISOString(),
                voidReason: action.reason.trim() || "No reason provided"
              }
            : transaction
        )
      };

    case "undo_recent_transaction": {
      const requestedAtMs = Date.parse(action.requestedAt);
      const latestAction = getLatestTransactionAction(state.transactions);
      if (
        !sameRecentAction(latestAction, action.action) ||
        !isRecentTransactionAction(action.action, requestedAtMs)
      ) {
        return state;
      }

      const target = state.transactions.find(
        (transaction) => transaction.id === action.action.transactionId
      );
      if (!target) {
        return state;
      }

      if (action.action.kind === "void") {
        if (target.voidedAt !== action.action.occurredAt) {
          return state;
        }

        return {
          ...state,
          transactions: state.transactions.map((transaction) =>
            transaction.id === target.id ? withoutVoid(transaction) : transaction
          )
        };
      }

      const linkedOriginalId =
        target.flippedFromTransactionId ?? target.correctsTransactionId;
      const expectedVoidReason = target.flippedFromTransactionId
        ? "Flipped transaction"
        : target.correctsTransactionId
          ? "Corrected chip count"
          : null;
      const linkedOriginal = linkedOriginalId
        ? state.transactions.find((transaction) => transaction.id === linkedOriginalId)
        : null;

      if (
        linkedOriginalId &&
        (!linkedOriginal || linkedOriginal.voidReason !== expectedVoidReason || !linkedOriginal.voidedAt)
      ) {
        return state;
      }

      let cashOutDrafts = state.cashOutDrafts;
      if (
        target.type === "bank_cash_out" &&
        target.fromPlayerId &&
        target.chipCountBreakdown !== undefined &&
        !cashOutDrafts.some((draft) => draft.playerId === target.fromPlayerId)
      ) {
        cashOutDrafts = [
          ...cashOutDrafts,
          {
            playerId: target.fromPlayerId,
            lines: target.chipCountBreakdown.map((line) => ({ ...line })),
            ...(target.correctsTransactionId
              ? { correctingTransactionId: target.correctsTransactionId }
              : {})
          }
        ];
      }

      return {
        ...state,
        transactions: state.transactions
          .filter((transaction) => transaction.id !== target.id)
          .map((transaction) =>
            linkedOriginal && transaction.id === linkedOriginal.id
              ? withoutVoid(transaction)
              : transaction
          ),
        cashOutDrafts
      };
    }

    default:
      return state;
  }
}
