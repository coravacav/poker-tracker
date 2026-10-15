import { normalizeSeatPlacements } from "../../domain/tableLayout";
import type { GameState, Player, PlayerId } from "../../domain/pokerTypes";

export function reconcileSeatIndexes(state: GameState): GameState {
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
