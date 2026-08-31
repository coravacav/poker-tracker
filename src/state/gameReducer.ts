import { hasPlayerTransactions } from "../domain/ledger";
import {
  currentFinalCashOutForPlayer,
  mergeChipCountLines,
  snapshotNonzeroChipCountLines
} from "../domain/chipCounts";
import {
  moveSeatPlacement,
  normalizeSeatPlacements
} from "../domain/tableLayout";
import { normalizeLegacyPlayerTransaction, normalizeLegacyPlayerTransactions } from "../domain/playerTransactions";
import type {
  AnyPersistedGameState,
  CashOutDraft,
  ChipDenomination,
  GameState,
  Player,
  PlayerId,
  SeatRail,
  Transaction,
  TransactionId
} from "../domain/pokerTypes";
import {
  getLatestTransactionAction,
  isRecentTransactionAction
} from "../domain/recentTransactionAction";
import type { RecentTransactionAction } from "../domain/recentTransactionAction";
import { migratePersistedState } from "./persistence";
import { createDefaultGameState, createId } from "./seedGame";

export type GameAction =
  | { type: "set_game_name"; name: string }
  | { type: "set_default_buy_in"; amountCents: number }
  | { type: "set_chip_denominations"; denominations: ChipDenomination[] }
  | { type: "set_table_shape"; shape: GameState["settings"]["tableShape"] }
  | { type: "move_table_seat"; seatIndex: number; rail: SeatRail; order: number }
  | { type: "move_player_to_seat"; playerId: PlayerId; seatIndex: number }
  | { type: "set_player_count"; count: number }
  | { type: "add_player"; name?: string }
  | { type: "replace_active_players"; names: string[] }
  | { type: "rename_player"; playerId: PlayerId; name: string }
  | { type: "archive_player"; playerId: PlayerId }
  | { type: "reorder_players"; orderedPlayerIds: PlayerId[] }
  | { type: "add_transaction"; transaction: Transaction }
  | { type: "add_transactions"; transactions: Transaction[] }
  | { type: "save_cash_out_draft"; draft: CashOutDraft }
  | { type: "clear_cash_out_draft"; playerId: PlayerId }
  | { type: "start_cash_out_correction"; playerId: PlayerId; transactionId: TransactionId }
  | { type: "record_cash_out"; transaction: Transaction }
  | {
      type: "replace_cash_out";
      originalTransactionId: TransactionId;
      replacement: Transaction;
    }
  | { type: "flip_transaction"; transactionId: TransactionId }
  | { type: "void_transaction"; transactionId: TransactionId; reason: string }
  | {
      type: "undo_recent_transaction";
      action: RecentTransactionAction;
      requestedAt: string;
    }
  | { type: "replace_state_from_import"; state: AnyPersistedGameState }
  | { type: "reset_game" };

function reconcileSeatIndexes(state: GameState): GameState {
  const activePlayers = [...state.players]
    .filter((player) => player.isActive)
    .sort((a, b) => a.seatIndex - b.seatIndex);
  const usedSeatIndexes = new Set<number>();
  const nextSeatByPlayerId = new Map<PlayerId, number>();
  const playersNeedingSeats: Player[] = [];

  for (const player of activePlayers) {
    if (
      Number.isInteger(player.seatIndex) &&
      player.seatIndex >= 0 &&
      player.seatIndex < Number.MAX_SAFE_INTEGER &&
      !usedSeatIndexes.has(player.seatIndex)
    ) {
      usedSeatIndexes.add(player.seatIndex);
      nextSeatByPlayerId.set(player.id, player.seatIndex);
    } else {
      playersNeedingSeats.push(player);
    }
  }

  for (const player of playersNeedingSeats) {
    let nextSeatIndex = 0;
    while (usedSeatIndexes.has(nextSeatIndex)) {
      nextSeatIndex += 1;
    }

    usedSeatIndexes.add(nextSeatIndex);
    nextSeatByPlayerId.set(player.id, nextSeatIndex);
  }

  const players = state.players.map((player) =>
    player.isActive
      ? { ...player, seatIndex: nextSeatByPlayerId.get(player.id) ?? player.seatIndex }
      : player
  );
  const activeSeatIndexes = players
    .filter((player) => player.isActive)
    .map((player) => player.seatIndex);

  return {
    ...state,
    settings: {
      ...state.settings,
      tableSeatPlacements: normalizeSeatPlacements(
        state.settings.tableSeatPlacements,
        activeSeatIndexes,
        state.settings.tableShape
      )
    },
    players
  };
}

function nextPlayerName(playersLength: number): string {
  return `Player ${playersLength + 1}`;
}

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

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case "set_game_name":
      return {
        ...state,
        settings: {
          ...state.settings,
          gameName: action.name
        }
      };

    case "set_default_buy_in":
      return {
        ...state,
        settings: {
          ...state.settings,
          defaultBuyInCents: action.amountCents
        }
      };

    case "set_chip_denominations":
      return {
        ...state,
        settings: {
          ...state.settings,
          chipDenominations: action.denominations.map((denomination) => ({ ...denomination }))
        },
        cashOutDrafts: state.cashOutDrafts.map((draft) => ({
          ...draft,
          lines: snapshotNonzeroChipCountLines(
            mergeChipCountLines(action.denominations, draft.lines)
          )
        }))
      };

    case "set_table_shape":
      return reconcileSeatIndexes({
        ...state,
        settings: {
          ...state.settings,
          tableShape: action.shape
        }
      });

    case "move_table_seat":
      return reconcileSeatIndexes({
        ...state,
        settings: {
          ...state.settings,
          tableSeatPlacements: moveSeatPlacement(
            state.settings.tableSeatPlacements,
            action.seatIndex,
            action.rail,
            action.order
          )
        }
      });

    case "move_player_to_seat": {
      const activePlayers = state.players.filter((player) => player.isActive);
      const activeSeatIndexes = new Set(activePlayers.map((player) => player.seatIndex));
      if (
        !Number.isInteger(action.seatIndex) ||
        action.seatIndex < 0 ||
        !activeSeatIndexes.has(action.seatIndex)
      ) {
        return state;
      }

      const movingPlayer = activePlayers.find((player) => player.id === action.playerId);
      if (!movingPlayer || movingPlayer.seatIndex === action.seatIndex) {
        return state;
      }

      const occupyingPlayer = activePlayers.find(
        (player) =>
          player.id !== movingPlayer.id && player.seatIndex === action.seatIndex
      );

      return {
        ...state,
        players: state.players.map((player) => {
          if (player.id === movingPlayer.id) {
            return { ...player, seatIndex: action.seatIndex };
          }

          if (occupyingPlayer && player.id === occupyingPlayer.id) {
            return { ...player, seatIndex: movingPlayer.seatIndex };
          }

          return player;
        })
      };
    }

    case "set_player_count": {
      const protectedPlayerIds = new Set(
        state.players
          .filter((player) => hasPlayerTransactions(player.id, state.transactions))
          .map((player) => player.id)
      );
      const playersWithProtectedActive = state.players.map((player) =>
        protectedPlayerIds.has(player.id) ? { ...player, isActive: true } : player
      );
      const activePlayers = playersWithProtectedActive.filter((player) => player.isActive);
      const targetCount = Math.max(
        1,
        protectedPlayerIds.size,
        action.count
      );

      if (targetCount > activePlayers.length) {
        const playersToAdd = targetCount - activePlayers.length;
        const newPlayers = Array.from({ length: playersToAdd }, (_, offset) => ({
          id: createId("player"),
          name: nextPlayerName(state.players.length + offset),
          seatIndex: Number.MAX_SAFE_INTEGER,
          isActive: true
        }));

        return reconcileSeatIndexes({
          ...state,
          players: [...playersWithProtectedActive, ...newPlayers]
        });
      }

      if (targetCount < activePlayers.length) {
        let remainingActiveCount = activePlayers.length;
        const players = [...playersWithProtectedActive]
          .sort((a, b) => b.seatIndex - a.seatIndex)
          .map((player) => {
            if (
              player.isActive &&
              remainingActiveCount > targetCount &&
              !protectedPlayerIds.has(player.id)
            ) {
              remainingActiveCount -= 1;
              return { ...player, isActive: false };
            }

            return player;
          });

        return reconcileSeatIndexes({
          ...state,
          players
        });
      }

      return reconcileSeatIndexes({
        ...state,
        players: playersWithProtectedActive
      });
    }

    case "add_player":
      return reconcileSeatIndexes({
        ...state,
        players: [
          ...state.players,
          {
            id: createId("player"),
            name: action.name?.trim() || nextPlayerName(state.players.length),
            seatIndex: Number.MAX_SAFE_INTEGER,
            isActive: true
          }
        ]
      });

    case "replace_active_players": {
      if (state.transactions.length > 0 || state.cashOutDrafts.length > 0) {
        return state;
      }

      const names = action.names.map((name) => name.trim()).filter(Boolean);
      if (names.length === 0) {
        return state;
      }

      const activePlayers = [...state.players]
        .filter((player) => player.isActive)
        .sort((a, b) => a.seatIndex - b.seatIndex);
      const activePlayerIndexById = new Map(
        activePlayers.map((player, index) => [player.id, index])
      );
      const players = state.players.map((player) => {
        if (!player.isActive) {
          return player;
        }

        const index = activePlayerIndexById.get(player.id);
        if (index === undefined || index >= names.length) {
          return { ...player, isActive: false };
        }

        return {
          ...player,
          name: names[index],
          seatIndex: index
        };
      });
      const newPlayers = names.slice(activePlayers.length).map((name, offset) => ({
        id: createId("player"),
        name,
        seatIndex: activePlayers.length + offset,
        isActive: true
      }));

      return reconcileSeatIndexes({
        ...state,
        players: [...players, ...newPlayers]
      });
    }

    case "rename_player":
      return {
        ...state,
        players: state.players.map((player) =>
          player.id === action.playerId
            ? { ...player, name: action.name.trim() || player.name }
            : player
        )
      };

    case "archive_player":
      if (hasPlayerTransactions(action.playerId, state.transactions)) {
        return state;
      }

      return reconcileSeatIndexes({
        ...state,
        players: state.players.map((player) =>
          player.id === action.playerId ? { ...player, isActive: false } : player
        )
      });

    case "reorder_players": {
      const seatById = new Map(
        action.orderedPlayerIds.map((playerId, index) => [playerId, index])
      );

      return reconcileSeatIndexes({
        ...state,
        players: state.players.map((player) => ({
          ...player,
          seatIndex: seatById.get(player.id) ?? player.seatIndex
        }))
      });
    }

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

    case "replace_state_from_import":
      return reconcileSeatIndexes(migratePersistedState(action.state));

    case "reset_game":
      return createDefaultGameState();

    default:
      return state;
  }
}
