import { hasPlayerTransactions } from "../domain/ledger";
import { getAutoSeatSlotCount } from "../domain/tableLayout";
import type {
  GameState,
  PersistedGameState,
  Player,
  PlayerId,
  Transaction,
  TransactionId
} from "../domain/pokerTypes";
import { createDefaultGameState, createId } from "./seedGame";

export type GameAction =
  | { type: "set_game_name"; name: string }
  | { type: "set_default_buy_in"; amountCents: number }
  | { type: "set_table_seat_layout"; layout: GameState["settings"]["tableSeatLayout"] }
  | { type: "set_table_include_corner_seats"; includeCornerSeats: boolean }
  | { type: "move_player_to_seat"; playerId: PlayerId; seatIndex: number }
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

const MAX_ACTIVE_PLAYERS = 12;

function reconcileSeatIndexes(state: GameState): GameState {
  const activePlayers = [...state.players]
    .filter((player) => player.isActive)
    .sort((a, b) => a.seatIndex - b.seatIndex);
  const slotCount = getAutoSeatSlotCount(activePlayers.length);
  const usedSeatIndexes = new Set<number>();
  const nextSeatByPlayerId = new Map<PlayerId, number>();
  const playersNeedingSeats: Player[] = [];

  for (const player of activePlayers) {
    if (
      Number.isInteger(player.seatIndex) &&
      player.seatIndex >= 0 &&
      player.seatIndex < slotCount &&
      !usedSeatIndexes.has(player.seatIndex)
    ) {
      usedSeatIndexes.add(player.seatIndex);
      nextSeatByPlayerId.set(player.id, player.seatIndex);
    } else {
      playersNeedingSeats.push(player);
    }
  }

  const availableSeatIndexes = Array.from({ length: slotCount }, (_, index) => index)
    .filter((index) => !usedSeatIndexes.has(index));

  for (const player of playersNeedingSeats) {
    const nextSeatIndex = availableSeatIndexes.shift();
    if (nextSeatIndex !== undefined) {
      nextSeatByPlayerId.set(player.id, nextSeatIndex);
    }
  }

  return {
    ...state,
    players: state.players.map((player) =>
      player.isActive
        ? { ...player, seatIndex: nextSeatByPlayerId.get(player.id) ?? player.seatIndex }
        : player
    )
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

    case "set_table_include_corner_seats":
      return {
        ...state,
        settings: {
          ...state.settings,
          tableIncludeCornerSeats: action.includeCornerSeats
        }
      };

    case "move_player_to_seat": {
      const activePlayers = state.players.filter((player) => player.isActive);
      const slotCount = getAutoSeatSlotCount(activePlayers.length);
      if (
        !Number.isInteger(action.seatIndex) ||
        action.seatIndex < 0 ||
        action.seatIndex >= slotCount
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
        Math.min(MAX_ACTIVE_PLAYERS, action.count)
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
      if (state.players.filter((player) => player.isActive).length >= MAX_ACTIVE_PLAYERS) {
        return state;
      }

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
      return reconcileSeatIndexes({
        ...action.state,
        settings: {
          ...action.state.settings,
          tableSeatLayout: action.state.settings.tableSeatLayout ?? "top_bottom",
          tableIncludeCornerSeats:
            action.state.settings.tableIncludeCornerSeats ?? true
        }
      });

    case "reset_game":
      return createDefaultGameState();

    default:
      return state;
  }
}
