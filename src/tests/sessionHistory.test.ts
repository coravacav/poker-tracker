import { beforeEach, describe, expect, it } from "vitest";
import { buildPlayerHistoryStats } from "../domain/sessionHistory";
import { archiveGame, loadArchivedGames, mergeArchivedGames } from "../state/gameArchive";
import { createDefaultGameState } from "../state/seedGame";

describe("session history", () => {
  beforeEach(() => localStorage.clear());

  it("archives a played game once", async () => {
    const state = createDefaultGameState();
    state.transactions.push({ id: "buy", type: "bank_buy_in", toPlayerId: state.players[0].id, amountCents: 2000, createdAt: "now" });
    expect(await archiveGame(state)).toBe(true);
    expect(await archiveGame(state)).toBe(true);
    expect(await loadArchivedGames()).toHaveLength(1);
  });

  it("aggregates players by name across games", () => {
    const state = createDefaultGameState();
    state.players = state.players.slice(0, 1);
    state.players[0].name = "Alex";
    state.transactions = [{ id: "buy", type: "bank_buy_in", toPlayerId: state.players[0].id, amountCents: 2000, createdAt: "now" }];
    const stats = buildPlayerHistoryStats([{ archivedAt: "now", state }]);
    expect(stats[0]).toMatchObject({
      name: "Alex",
      games: 1,
      results: [{ currencyCode: "USD", games: 1, totalNetCents: -2000, averageNetCents: -2000 }]
    });
  });

  it("merges restored games, keeping the newest copy of each", async () => {
    const kept = createDefaultGameState();
    kept.transactions.push({ id: "buy", type: "bank_buy_in", toPlayerId: kept.players[0].id, amountCents: 2000, createdAt: "now" });
    await archiveGame(kept);
    const restored = createDefaultGameState();
    expect(await mergeArchivedGames([
      { archivedAt: "2000-01-01T00:00:00.000Z", state: { ...kept, transactions: [] } },
      { archivedAt: "2001-01-01T00:00:00.000Z", state: restored }
    ])).toBe(true);
    const games = await loadArchivedGames();
    expect(games.map((game) => game.state.localGameId)).toEqual([kept.localGameId, restored.localGameId]);
    expect(games[0].state.transactions).toHaveLength(1);
  });
});
