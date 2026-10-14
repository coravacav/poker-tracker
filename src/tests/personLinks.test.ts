import { describe, expect, it } from "vitest";
import type { GameState } from "../domain/pokerTypes";
import { validatePersistedState } from "../domain/validation";
import { applyHostedAction, normalizeGameState, roomStateError, sanitizeGuestState } from "../session/roomProtocol";
import { gameReducer } from "../state/gameReducer";
import { migratePersistedState } from "../state/persistence";
import { createDefaultGameState } from "../state/seedGame";

function game(): GameState {
  const state = createDefaultGameState();
  state.players = state.players.slice(0, 2);
  state.players[0] = { ...state.players[0], name: "Mike", personId: "person_mike" };
  return state;
}

describe("player person links in the reducer", () => {
  it("adds players with a person link only when the action carries a valid one", () => {
    const state = createDefaultGameState();
    const added = gameReducer(state, { type: "add_player", name: "Alex", personId: "person_alex" });
    expect(added.players[added.players.length - 1]).toMatchObject({ name: "Alex", personId: "person_alex" });
    const invalid = gameReducer(state, { type: "add_player", name: "Alex", personId: "not valid!" });
    expect(invalid.players[invalid.players.length - 1]).not.toHaveProperty("personId");
    const placeholder = gameReducer(state, { type: "add_player", personId: "person_alex" });
    expect(placeholder.players[placeholder.players.length - 1]).not.toHaveProperty("personId");
  });

  it("links, unlinks, and keeps links on rename", () => {
    const state = game();
    const id = state.players[0].id;
    const relinked = gameReducer(state, { type: "rename_player", playerId: id, name: "Michael", personId: "person_michael" });
    expect(relinked.players[0]).toMatchObject({ name: "Michael", personId: "person_michael" });
    const unlinked = gameReducer(state, { type: "rename_player", playerId: id, name: "Mike", personId: null });
    expect(unlinked.players[0]).not.toHaveProperty("personId");
    // Older clients omit personId: a case-only change keeps the link, a new name drops it.
    expect(gameReducer(state, { type: "rename_player", playerId: id, name: "MIKE" }).players[0].personId).toBe("person_mike");
    expect(gameReducer(state, { type: "rename_player", playerId: id, name: "Sam" }).players[0]).not.toHaveProperty("personId");
    expect(gameReducer(state, { type: "rename_player", playerId: id, name: "  ", personId: null })).toBe(state);
  });

  it("applies parallel person links in fast entry", () => {
    const state = game();
    const next = gameReducer(state, {
      type: "replace_active_players",
      names: ["Mike", "", "Blair", "Casey"],
      personIds: [undefined, "person_ignored", "person_blair", "person_casey"]
    });
    const active = next.players.filter((player) => player.isActive).sort((a, b) => a.seatIndex - b.seatIndex);
    expect(active.map((player) => [player.name, player.personId])).toEqual([
      ["Mike", "person_mike"],
      ["Blair", "person_blair"],
      ["Casey", "person_casey"]
    ]);
    const withoutLinks = gameReducer(state, { type: "replace_active_players", names: ["Sam", "Blair"] });
    expect(withoutLinks.players.every((player) => player.personId === undefined)).toBe(true);
  });
});

describe("person links in saved games", () => {
  it("keeps the schema at 7 and round-trips valid links", () => {
    const state = game();
    const stored = JSON.parse(JSON.stringify(state)) as unknown;
    expect(validatePersistedState(stored)).toBe(true);
    const loaded = migratePersistedState(stored as GameState);
    expect(loaded.schemaVersion).toBe(7);
    expect(loaded.players[0].personId).toBe("person_mike");
  });

  it("tolerates links it cannot use instead of rejecting the save", () => {
    const stored = JSON.parse(JSON.stringify(game())) as GameState;
    (stored.players[1] as { personId?: unknown }).personId = { future: "format" };
    expect(validatePersistedState(stored)).toBe(true);
    const loaded = migratePersistedState(stored);
    expect(loaded.players[0].personId).toBe("person_mike");
    expect(loaded.players[1]).not.toHaveProperty("personId");
  });
});

describe("person links in shared rooms", () => {
  it("keeps links in the host snapshot and strips them for guests", () => {
    const state = game();
    expect(roomStateError(state)).toBeNull();
    expect(normalizeGameState(state).players[0].personId).toBe("person_mike");
    expect(sanitizeGuestState(state).players.some((player) => "personId" in player)).toBe(false);
    const bad = { ...state, players: [{ ...state.players[0], personId: "x".repeat(500) }, state.players[1]] };
    expect(normalizeGameState(bad).players[0]).not.toHaveProperty("personId");
  });

  it("applies hosted renames that carry a link", () => {
    const state = game();
    const result = applyHostedAction(
      state,
      { type: "rename_player", playerId: state.players[1].id, name: "Blair", personId: "person_blair" },
      "2026-10-14T00:00:00.000Z",
      () => "transaction_1"
    );
    expect("state" in result && result.state.players[1]).toMatchObject({ name: "Blair", personId: "person_blair" });
  });
});
