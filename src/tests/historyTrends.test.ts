import { describe, expect, it } from "vitest";
import {
  buildPersonTimelines,
  cumulativeSeries,
  filterGamesByRange,
  gamePlayedAtMs,
  historyCurrencies,
  initialSeriesSlots,
  MAX_CHART_SERIES,
  rangeStartMs,
  summarizePersonResults,
  toggleSeriesSlot,
  type SeriesSlots
} from "../domain/historyTrends";
import type { CurrencyCode } from "../domain/money";
import { EMPTY_PEOPLE_DIRECTORY, type PeopleDirectory } from "../domain/people";
import type { ArchivedGame } from "../domain/sessionHistory";
import { createDefaultGameState } from "../state/seedGame";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-10-14T12:00:00.000Z");
let gameCount = 0;

/** A game played `daysAgo` days before NOW; positive results cash out, negative ones buy in. */
function game(daysAgo: number, results: Record<string, number>, currencyCode: CurrencyCode = "USD"): ArchivedGame {
  const playedAt = new Date(NOW - daysAgo * DAY).toISOString();
  const state = createDefaultGameState(currencyCode);
  gameCount += 1;
  state.localGameId = `game_${gameCount}`;
  state.settings.gameName = `Night ${gameCount}`;
  const names = Object.keys(results);
  state.players = names.map((name, index) => ({ id: `p${gameCount}_${index}`, name, seatIndex: index, isActive: true }));
  state.transactions = names.map((name, index) => {
    const netCents = results[name];
    return netCents < 0
      ? { id: `t${gameCount}_${index}`, type: "bank_buy_in" as const, toPlayerId: state.players[index].id, amountCents: -netCents, createdAt: playedAt }
      : {
          id: `t${gameCount}_${index}`,
          type: "bank_cash_out" as const,
          cashOutKind: "final" as const,
          fromPlayerId: state.players[index].id,
          amountCents: netCents,
          createdAt: playedAt
        };
  });
  // Archived when the next game started, days later.
  return { archivedAt: new Date(NOW - daysAgo * DAY + 5 * DAY).toISOString(), state };
}

describe("game dates", () => {
  it("dates a game by its first transaction, not by when it was archived", () => {
    const played = game(10, { Alex: -1000, Blair: 1000 });
    played.state.transactions[1].createdAt = new Date(NOW - 11 * DAY).toISOString();
    played.state.transactions.push({ ...played.state.transactions[0], id: "bad", createdAt: "not a date" });
    expect(gamePlayedAtMs(played)).toBe(NOW - 11 * DAY);
  });

  it("falls back to the game's creation time, then its archive time", () => {
    const empty = game(3, {});
    empty.state.settings.createdAt = new Date(NOW - 4 * DAY).toISOString();
    expect(gamePlayedAtMs(empty)).toBe(NOW - 4 * DAY);
    empty.state.settings.createdAt = "";
    expect(gamePlayedAtMs(empty)).toBe(Date.parse(empty.archivedAt));
  });

  it("filters games by date range", () => {
    const games = [game(5, { Alex: 1 }), game(45, { Alex: 1 }), game(200, { Alex: 1 }), game(400, { Alex: 1 })];
    expect(rangeStartMs("all", NOW)).toBeNull();
    expect(filterGamesByRange(games, "all", NOW)).toBe(games);
    expect(filterGamesByRange(games, "30d", NOW)).toEqual([games[0]]);
    expect(filterGamesByRange(games, "90d", NOW)).toEqual(games.slice(0, 2));
    expect(filterGamesByRange(games, "1y", NOW)).toEqual(games.slice(0, 3));
    // A game exactly at the range start counts.
    expect(filterGamesByRange([game(30, { Alex: 1 })], "30d", NOW)).toHaveLength(1);
  });
});

describe("per-currency series", () => {
  const games = [
    game(1, { Alex: 500, Blair: -500 }, "EUR"),
    game(2, { Alex: -300, Blair: 300 }),
    game(3, { Alex: 1000, Casey: -1000 }),
    game(4, { Blair: 200, Casey: -200 }),
    game(5, { Alex: -2000, Blair: 2000 })
  ];

  it("lists the main currency first", () => {
    expect(historyCurrencies(games)).toEqual(["USD", "EUR"]);
    expect(historyCurrencies(games.slice(0, 1))).toEqual(["EUR"]);
    expect(historyCurrencies([])).toEqual([]);
  });

  it("builds each person's games in one currency, oldest first", () => {
    const usd = buildPersonTimelines(games, EMPTY_PEOPLE_DIRECTORY, "USD");
    expect(usd.map((timeline) => [timeline.name, timeline.results.length])).toEqual([
      ["Alex", 3],
      ["Blair", 3],
      ["Casey", 2]
    ]);
    const alex = usd[0];
    expect(alex.key).toBe("name:alex");
    expect(alex.results.map((result) => result.netCents)).toEqual([-2000, 1000, -300]);
    expect(alex.results.map((result) => result.playedAtMs)).toEqual([NOW - 5 * DAY, NOW - 3 * DAY, NOW - 2 * DAY]);
    expect(alex.results[0]).toMatchObject({ gameId: games[4].state.localGameId, gameName: games[4].state.settings.gameName });

    // Euro games are their own series and never added to dollar totals.
    const eur = buildPersonTimelines(games, EMPTY_PEOPLE_DIRECTORY, "EUR");
    expect(eur.map((timeline) => [timeline.name, timeline.results.map((result) => result.netCents)])).toEqual([
      ["Alex", [500]],
      ["Blair", [-500]]
    ]);
    expect(buildPersonTimelines(games, EMPTY_PEOPLE_DIRECTORY, "GBP")).toEqual([]);
  });

  it("groups by person like the stats table", () => {
    const directory: PeopleDirectory = {
      schemaVersion: 1,
      people: [{ id: "person_a", name: "Alexandra", aliases: ["Alex"], createdAt: "", updatedAt: "" }]
    };
    const [first] = buildPersonTimelines(games, directory, "USD");
    expect(first).toMatchObject({ key: "person:person_a", name: "Alexandra" });
  });

  it("accumulates running totals and summarizes results", () => {
    const [alex] = buildPersonTimelines(games, EMPTY_PEOPLE_DIRECTORY, "USD");
    expect(cumulativeSeries(alex.results).map((point) => point.cumulativeCents)).toEqual([-2000, -1000, -1300]);
    expect(cumulativeSeries([])).toEqual([]);
    expect(summarizePersonResults("USD", alex.results)).toEqual({
      currencyCode: "USD",
      games: 3,
      totalNetCents: -1300,
      averageNetCents: -433,
      biggestWinCents: 1000,
      biggestLossCents: -2000,
      wins: 1,
      winRate: 1 / 3
    });
    expect(summarizePersonResults("USD", [])).toBeNull();
  });
});

describe("chart colors", () => {
  it("defaults to the people with the most games", () => {
    const timelines = ["a", "b", "c", "d", "e", "f"].map((key) => ({ key, name: key, results: [] }));
    expect(initialSeriesSlots(timelines)).toEqual(["a", "b", "c", "d", "e"]);
    expect(initialSeriesSlots(timelines, 2)).toEqual(["a", "b"]);
  });

  it("keeps everyone's color when someone is hidden or shown", () => {
    let slots: SeriesSlots = ["a", "b", "c"];
    slots = toggleSeriesSlot(slots, "b");
    expect(slots).toEqual(["a", null, "c"]);
    // The next person takes the freed color; nobody else moves.
    slots = toggleSeriesSlot(slots, "d");
    expect(slots).toEqual(["a", "d", "c"]);
    slots = toggleSeriesSlot(slots, "e");
    expect(slots).toEqual(["a", "d", "c", "e"]);
    // Trailing free slots are dropped.
    expect(toggleSeriesSlot(slots, "e")).toEqual(["a", "d", "c"]);
    expect(toggleSeriesSlot(["a"], "a")).toEqual([]);
  });

  it("refuses more people than there are colors", () => {
    const full = Array.from({ length: MAX_CHART_SERIES }, (_, index) => `p${index}`);
    expect(toggleSeriesSlot(full, "extra")).toBe(full);
    expect(toggleSeriesSlot(full, "p3")[3]).toBeNull();
  });
});
