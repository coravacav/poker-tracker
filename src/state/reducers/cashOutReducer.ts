import { currentFinalCashOutForPlayer } from "../../domain/chipCounts";
import type { GameState } from "../../domain/pokerTypes";
import type { CashOutAction } from "../gameActions";

export function reduceCashOutAction(state: GameState, action: CashOutAction): GameState {
  switch (action.type) {
    case "save_cash_out_draft":
      return {
        ...state,
        cashOutDrafts: [
          ...state.cashOutDrafts.filter(
            (draft) => draft.playerId !== action.draft.playerId
          ),
          {
            ...action.draft,
            lines: action.draft.lines.map((line) => ({ ...line }))
          }
        ]
      };

    case "clear_cash_out_draft":
      return {
        ...state,
        cashOutDrafts: state.cashOutDrafts.filter(
          (draft) => draft.playerId !== action.playerId
        )
      };

    case "start_cash_out_correction": {
      const original = currentFinalCashOutForPlayer(state.transactions, action.playerId);
      if (!original || original.id !== action.transactionId) return state;

      return {
        ...state,
        cashOutDrafts: [
          ...state.cashOutDrafts.filter((draft) => draft.playerId !== action.playerId),
          {
            playerId: action.playerId,
            lines: (original.chipCountBreakdown ?? []).map((line) => ({ ...line })),
            correctingTransactionId: original.id
          }
        ]
      };
    }

    case "record_cash_out": {
      if (
        action.transaction.type !== "bank_cash_out" ||
        action.transaction.cashOutKind !== "final" ||
        !action.transaction.fromPlayerId ||
        action.transaction.chipCountBreakdown === undefined
      ) {
        return state;
      }

      return {
        ...state,
        transactions: [
          ...state.transactions,
          {
            ...action.transaction,
            chipCountBreakdown: action.transaction.chipCountBreakdown.map((line) => ({
              ...line
            }))
          }
        ],
        cashOutDrafts: state.cashOutDrafts.filter(
          (draft) => draft.playerId !== action.transaction.fromPlayerId
        )
      };
    }

    case "replace_cash_out": {
      const original = state.transactions.find(
        (transaction) => transaction.id === action.originalTransactionId
      );
      if (
        !original ||
        original.voidedAt ||
        original.type !== "bank_cash_out" ||
        original.cashOutKind !== "final" ||
        action.replacement.type !== "bank_cash_out" ||
        action.replacement.cashOutKind !== "final" ||
        original.fromPlayerId !== action.replacement.fromPlayerId ||
        action.replacement.chipCountBreakdown === undefined ||
        action.replacement.correctsTransactionId !== original.id
      ) {
        return state;
      }

      const voidedAt = new Date().toISOString();
      return {
        ...state,
        transactions: [
          ...state.transactions.map((transaction) =>
            transaction.id === original.id
              ? {
                  ...transaction,
                  voidedAt,
                  voidReason: "Corrected chip count"
                }
              : transaction
          ),
          {
            ...action.replacement,
            chipCountBreakdown: action.replacement.chipCountBreakdown.map((line) => ({
              ...line
            }))
          }
        ],
        cashOutDrafts: state.cashOutDrafts.filter(
          (draft) => draft.playerId !== action.replacement.fromPlayerId
        )
      };
    }

    default:
      return state;
  }
}
