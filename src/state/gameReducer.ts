import { hasPlayerTransactions } from "../domain/ledger";
import {
  moveSeatPlacement,
  normalizeSeatPlacements
} from "../domain/tableLayout";
import type {
  AnyPersistedGameState,
  GameState,
  Player,
  PlayerId,
  SeatRail,
  Transaction,
  TransactionId
} from "../domain/pokerTypes";
import { migratePersistedState } from "./persistence";
import { createDefaultGameState, createId } from "./seedGame";

export type GameAction =
  | { type: "set_game_name"; name: string }
  | { type: "set_default_buy_in"; amountCents: number }
  | { type: "set_table_shape"; shape: GameState["settings"]["tableShape"] }
  | { type: "move_table_seat"; seatIndex: number; rail: SeatRail; order: number }
  | { type: "move_player_to_seat"; playerId: PlayerId; seatIndex: number }
  | { type: "set_player_count"; count: number }
  | { type: "add_player"; name?: string }
  | { type: "rename_player"; playerId: PlayerId; name: string }
  | { type: "archive_player"; playerId: PlayerId }
  | { type: "reorder_players"; orderedPlayerIds: PlayerId[] }
  | { type: "add_transaction"; transaction: Transaction }
  | { type: "flip_transaction"; transactionId: TransactionId }
  | { type: "void_transaction"; transactionId: TransactionId; reason: string }
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
      return reconcileSeatIndexes(migratePersistedState(action.state));

    case "reset_game":
      return createDefaultGameState();

    default:
      return state;
  }
}
