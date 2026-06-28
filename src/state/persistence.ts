import type {
  AnyPersistedGameState,
  GameState,
  Player,
  TableSeatLayout,
  TableShape
} from "../domain/pokerTypes";
import {
  createDefaultSeatPlacements,
  normalizeSeatPlacements
} from "../domain/tableLayout";
import { validatePersistedState } from "../domain/validation";
import { createDefaultGameState } from "./seedGame";

export const STORAGE_KEY = "poker-tracker:v1:current-game";

function shapeFromLegacyLayout(layout: TableSeatLayout | undefined): TableShape {
  if (layout === "round") {
    return "round";
  }

  if (layout === "top_bottom" || layout === "left_right") {
    return "oval";
  }

  return "rectangle";
}

function activeSeatIndexes(players: Player[]): number[] {
  return players
    .filter((player) => player.isActive)
    .map((player) => player.seatIndex)
    .sort((a, b) => a - b);
}

function resetActiveSeatIndexes(players: Player[]): Player[] {
  const activePlayers = [...players]
    .filter((player) => player.isActive)
    .sort((a, b) => a.seatIndex - b.seatIndex);
  const nextSeatByPlayerId = new Map(
    activePlayers.map((player, seatIndex) => [player.id, seatIndex])
  );

  return players.map((player) =>
    player.isActive
      ? { ...player, seatIndex: nextSeatByPlayerId.get(player.id) ?? player.seatIndex }
      : player
  );
}

export function migratePersistedState(state: AnyPersistedGameState): GameState {
  if (state.schemaVersion === 2) {
    return {
      ...state,
      settings: {
        ...state.settings,
        tableSeatPlacements: normalizeSeatPlacements(
          state.settings.tableSeatPlacements,
          activeSeatIndexes(state.players),
          state.settings.tableShape
        )
      }
    };
  }

  const players = resetActiveSeatIndexes(state.players);
  const activeCount = players.filter((player) => player.isActive).length;
  const tableShape = shapeFromLegacyLayout(state.settings.tableSeatLayout);

  return {
    schemaVersion: 2,
    settings: {
      gameName: state.settings.gameName,
      currencyCode: state.settings.currencyCode,
      defaultBuyInCents: state.settings.defaultBuyInCents,
      tableShape,
      tableSeatPlacements: createDefaultSeatPlacements(activeCount, tableShape),
      createdAt: state.settings.createdAt
    },
    players,
    transactions: state.transactions
  };
}

export function loadGameState(): GameState {
  if (typeof localStorage === "undefined") {
    return createDefaultGameState();
  }

  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    return createDefaultGameState();
  }

  try {
    const parsed = JSON.parse(stored) as unknown;
    return validatePersistedState(parsed)
      ? migratePersistedState(parsed)
      : createDefaultGameState();
  } catch {
    return createDefaultGameState();
  }
}

export function saveGameState(state: GameState): void {
  if (typeof localStorage === "undefined") {
    return;
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
