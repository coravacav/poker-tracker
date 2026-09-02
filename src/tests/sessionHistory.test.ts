import { beforeEach, describe, expect, it } from "vitest";
import { archiveGame, buildPlayerHistoryStats, loadArchivedGames } from "../domain/sessionHistory";
import { createDefaultGameState } from "../state/seedGame";

describe("session history", () => {
  beforeEach(() => localStorage.clear());

  it("archives a played game once", () => {
    const state = createDefaultGameState();
    state.transactions.push({ id: "buy", type: "bank_buy_in", toPlayerId: state.players[0].id, amountCents: 2000, createdAt: "now" });
    expect(archiveGame(state)).toBe(true);
    expect(archiveGame(state)).toBe(true);
    expect(loadArchivedGames()).toHaveLength(1);
  });

  it("aggregates players by name across games", () => {
    const state = createDefaultGameState();
    state.players = state.players.slice(0, 1);
    state.players[0].name = "Alex";
    state.transactions = [{ id: "buy", type: "bank_buy_in", toPlayerId: state.players[0].id, amountCents: 2000, createdAt: "now" }];
    const stats = buildPlayerHistoryStats([{ archivedAt: "now", state }]);
    expect(stats[0]).toMatchObject({ name: "Alex", games: 1, totalNetCents: -2000 });
  });
});
