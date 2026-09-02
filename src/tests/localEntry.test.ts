import { beforeEach, describe, expect, it } from "vitest";
import {
  LAST_VISIT_KEY,
  LOCAL_ENTRY_TIMEOUT_MS,
  loadInitialLocalEntry,
  readLastVisitAt,
  shouldShowLocalEntry,
  writeLastVisitAt
} from "../session/localEntry";
import { STORAGE_KEY } from "../state/persistence";
import { createDefaultGameState } from "../state/seedGame";

describe("local entry timing", () => {
  beforeEach(() => localStorage.clear());

  it("prompts on a first visit and does not create a phantom saved game", () => {
    const entry = loadInitialLocalEntry(1_000);

    expect(entry).toMatchObject({ reason: "first_visit", savedGame: null });
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("uses a strict greater-than 24-hour boundary", () => {
    expect(shouldShowLocalEntry(null, 1_000)).toBe(true);
    expect(shouldShowLocalEntry(1_000, 1_000 + LOCAL_ENTRY_TIMEOUT_MS)).toBe(false);
    expect(shouldShowLocalEntry(1_000, 1_001 + LOCAL_ENTRY_TIMEOUT_MS)).toBe(true);
  });

  it("handles malformed and future visit markers safely", () => {
    localStorage.setItem(LAST_VISIT_KEY, "not-a-timestamp");
    expect(readLastVisitAt()).toBeNull();
    expect(shouldShowLocalEntry(readLastVisitAt(), 1_000)).toBe(true);

    localStorage.setItem(LAST_VISIT_KEY, "2000");
    expect(shouldShowLocalEntry(readLastVisitAt(), 1_000)).toBe(false);
  });

  it("loads and migrates a valid saved game for the start page", () => {
    const state = createDefaultGameState();
    state.settings.gameName = "Friday Night";
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    writeLastVisitAt(0);

    expect(loadInitialLocalEntry(LOCAL_ENTRY_TIMEOUT_MS + 1)?.savedGame).toMatchObject({
      localGameId: state.localGameId,
      settings: { gameName: "Friday Night" }
    });
  });
});
