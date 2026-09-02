import type { GameState } from "../domain/pokerTypes";
import { loadSavedGameState } from "../state/persistence";

export const LAST_VISIT_KEY = "poker-tracker:v1:last-visit-at";
export const LOCAL_ENTRY_TIMEOUT_MS = 24 * 60 * 60 * 1000;

export type LocalEntryReason = "first_visit" | "stale_return";

export type LocalEntry = {
  reason: LocalEntryReason;
  savedGame: GameState | null;
  error?: string;
};

function localStorageOrUndefined(): Storage | undefined {
  return typeof localStorage === "undefined" ? undefined : localStorage;
}

export function readLastVisitAt(storage: Storage | undefined = localStorageOrUndefined()): number | null {
  if (!storage) return null;

  try {
    const stored = storage.getItem(LAST_VISIT_KEY);
    if (stored === null || stored.trim() === "") return null;
    const value = Number(stored);
    return Number.isFinite(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

export function writeLastVisitAt(
  timestamp = Date.now(),
  storage: Storage | undefined = localStorageOrUndefined()
): boolean {
  if (!storage || !Number.isFinite(timestamp) || timestamp < 0) return false;

  try {
    storage.setItem(LAST_VISIT_KEY, String(timestamp));
    return true;
  } catch {
    return false;
  }
}

export function shouldShowLocalEntry(
  lastVisitAt: number | null,
  now = Date.now()
): boolean {
  if (!Number.isFinite(now)) return false;
  if (lastVisitAt === null) return true;
  return now - lastVisitAt > LOCAL_ENTRY_TIMEOUT_MS;
}

export function loadInitialLocalEntry(now = Date.now()): LocalEntry | null {
  const lastVisitAt = readLastVisitAt();
  if (!shouldShowLocalEntry(lastVisitAt, now)) return null;

  return {
    reason: lastVisitAt === null ? "first_visit" : "stale_return",
    savedGame: loadSavedGameState()
  };
}
