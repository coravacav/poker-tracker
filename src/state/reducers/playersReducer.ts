import { hasPlayerTransactions } from "../../domain/ledger";
import type { GameState, Player } from "../../domain/pokerTypes";
import { isValidPersonId, nameKey } from "../../domain/people";
import { normalizeVenmoHandle } from "../../domain/venmo";
import { createId } from "../seedGame";
import type { PlayerAction } from "../gameActions";
import { reconcileSeatIndexes } from "./seatIndexes";

/** Applies a person link from an action to a renamed player (see rename_player). */
function withPersonLink(next: Player, previous: Player, personId: string | null | undefined): Player {
  const { personId: _previousPersonId, ...unlinked } = next;
  if (personId === undefined) {
    return nameKey(next.name) === nameKey(previous.name) && previous.personId
      ? { ...unlinked, personId: previous.personId }
      : unlinked;
  }
  return isValidPersonId(personId) ? { ...unlinked, personId } : unlinked;
}

/**
 * Applies a Venmo username from an action: undefined keeps the current one,
 * null clears it, and a string sets it when it is a usable username.
 */
function withVenmoHandle(player: Player, venmoHandle: string | null | undefined): Player {
  if (venmoHandle === undefined) return player;
  const normalized = venmoHandle === null ? null : normalizeVenmoHandle(venmoHandle);
  if (venmoHandle !== null && !normalized) return player;
  if ((player.venmoHandle ?? null) === normalized) return player;
  const { venmoHandle: _previous, ...rest } = player;
  return normalized ? { ...rest, venmoHandle: normalized } : rest;
}

function nextPlayerName(playersLength: number): string {
  return `Player ${playersLength + 1}`;
}

export function reducePlayerAction(state: GameState, action: PlayerAction): GameState {
  switch (action.type) {
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
            isActive: true,
            ...(action.name?.trim() && isValidPersonId(action.personId) ? { personId: action.personId } : {})
          }
        ]
      });

    case "replace_active_players": {
      if (state.transactions.length > 0 || state.cashOutDrafts.length > 0) {
        return state;
      }

      const entries = action.names
        .map((name, index) => ({
          name: name.trim(),
          personId: action.personIds?.[index],
          venmoHandle: action.venmoHandles?.[index]
        }))
        .filter((entry) => entry.name);
      const names = entries.map((entry) => entry.name);
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

        return withVenmoHandle(
          withPersonLink({ ...player, name: names[index], seatIndex: index }, player, entries[index].personId),
          entries[index].venmoHandle
        );
      });
      const newPlayers = entries.slice(activePlayers.length).map(({ name, personId, venmoHandle }, offset): Player =>
        withVenmoHandle(
          {
            id: createId("player"),
            name,
            seatIndex: activePlayers.length + offset,
            isActive: true,
            ...(isValidPersonId(personId) ? { personId } : {})
          },
          venmoHandle
        )
      );

      return reconcileSeatIndexes({
        ...state,
        players: [...players, ...newPlayers]
      });
    }

    case "rename_player":
      if (!action.name.trim()) return state;
      return {
        ...state,
        players: state.players.map((player) =>
          player.id === action.playerId
            ? withVenmoHandle(
                withPersonLink({ ...player, name: action.name.trim() }, player, action.personId),
                action.venmoHandle
              )
            : player
        )
      };

    case "set_player_venmo_handle": {
      const target = state.players.find((player) => player.id === action.playerId);
      if (!target || (action.venmoHandle !== null && typeof action.venmoHandle !== "string")) return state;
      const updated = withVenmoHandle(target, action.venmoHandle);
      if (updated === target) return state;
      return {
        ...state,
        players: state.players.map((player) => (player.id === action.playerId ? updated : player))
      };
    }

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
      const activePlayers = state.players.filter((player) => player.isActive);
      const activePlayerIds = new Set(activePlayers.map((player) => player.id));
      const orderedPlayerIds = action.orderedPlayerIds.filter(
        (playerId, index, playerIds) =>
          activePlayerIds.has(playerId) && playerIds.indexOf(playerId) === index
      );

      if (orderedPlayerIds.length !== activePlayers.length) {
        return state;
      }

      const activeSeatIndexes = activePlayers
        .map((player) => player.seatIndex)
        .sort((left, right) => left - right);
      const seatById = new Map(
        orderedPlayerIds.map((playerId, index) => [playerId, activeSeatIndexes[index]])
      );

      return reconcileSeatIndexes({
        ...state,
        players: state.players.map((player) => ({
          ...player,
          seatIndex: player.isActive
            ? seatById.get(player.id) ?? player.seatIndex
            : player.seatIndex
        }))
      });
    }

    default:
      return state;
  }
}
