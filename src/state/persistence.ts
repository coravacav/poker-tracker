import type { GameState } from "../domain/pokerTypes";
import { validatePersistedState } from "../domain/validation";
import { createDefaultGameState } from "./seedGame";

export const STORAGE_KEY = "poker-tracker:v1:current-game";

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
      ? {
          ...parsed,
          settings: {
            ...parsed.settings,
            tableSeatLayout: parsed.settings.tableSeatLayout ?? "top_bottom"
          }
        }
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
