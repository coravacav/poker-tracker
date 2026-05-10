import { hasPlayerTransactions } from "../domain/ledger";
import type {
  GameState,
  PersistedGameState,
  PlayerId,
  Transaction,
  TransactionId
} from "../domain/pokerTypes";
import { createDefaultGameState, createId } from "./seedGame";

export type GameAction =
  | { type: "set_game_name"; name: string }
  | { type: "set_default_buy_in"; amountCents: number }
  | { type: "set_table_seat_layout"; layout: GameState["settings"]["tableSeatLayout"] }
  | { type: "set_player_count"; count: number }
  | { type: "add_player"; name?: string }
  | { type: "rename_player"; playerId: PlayerId; name: string }
  | { type: "archive_player"; playerId: PlayerId }
  | { type: "reorder_players"; orderedPlayerIds: PlayerId[] }
  | { type: "add_transaction"; transaction: Transaction }
  | { type: "flip_transaction"; transactionId: TransactionId }
  | { type: "void_transaction"; transactionId: TransactionId; reason: string }
  | { type: "replace_state_from_import"; state: PersistedGameState }
  | { type: "reset_game" };

function normalizeSeatIndexes(state: GameState): GameState {
  return {
    ...state,
    players: [...state.players]
      .sort((a, b) => a.seatIndex - b.seatIndex)
      .map((player, index) => ({ ...player, seatIndex: index }))
  };
}

function nextPlayerName(playersLength: number): string {
  return `Player ${playersLength + 1}`;
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

    case "set_table_seat_layout":
      return {
        ...state,
        settings: {
          ...state.settings,
          tableSeatLayout: action.layout
        }
      };

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
        Math.min(12, action.count)
      );

      if (targetCount > activePlayers.length) {
        const playersToAdd = targetCount - activePlayers.length;
        const newPlayers = Array.from({ length: playersToAdd }, (_, offset) => ({
          id: createId("player"),
          name: nextPlayerName(state.players.length + offset),
          seatIndex: state.players.length + offset,
          isActive: true
        }));

        return normalizeSeatIndexes({
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

        return normalizeSeatIndexes({
          ...state,
          players
        });
      }

      return state;
    }

    case "add_player":
      return normalizeSeatIndexes({
        ...state,
        players: [
          ...state.players,
          {
            id: createId("player"),
            name: action.name?.trim() || nextPlayerName(state.players.length),
            seatIndex: state.players.length,
            isActive: true
          }
        ]
      });

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

      return normalizeSeatIndexes({
        ...state,
        players: state.players.map((player) =>
          player.id === action.playerId ? { ...player, isActive: false } : player
        )
      });

    case "reorder_players": {
      const seatById = new Map(
        action.orderedPlayerIds.map((playerId, index) => [playerId, index])
      );

      return normalizeSeatIndexes({
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
        transactions: [...state.transactions, action.transaction]
      };

    case "flip_transaction": {
      const original = state.transactions.find(
        (transaction) => transaction.id === action.transactionId
      );

      if (!original || original.voidedAt) {
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

      if (original.type === "player_transfer") {
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
          category: undefined
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
          category: undefined
        };
      }

      if (original.type === "manual_bank_adjustment") {
        flippedTransaction = {
          ...flippedBase,
          bankDirection: original.bankDirection === "outgoing" ? "incoming" : "outgoing",
          fromPlayerId: undefined,
          toPlayerId: undefined,
          category: undefined
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

    case "replace_state_from_import":
      return normalizeSeatIndexes({
        ...action.state,
        settings: {
          ...action.state.settings,
          tableSeatLayout: action.state.settings.tableSeatLayout ?? "top_bottom"
        }
      });

    case "reset_game":
      return createDefaultGameState();

    default:
      return state;
  }
}
