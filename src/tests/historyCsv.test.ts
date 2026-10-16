import { describe, expect, it } from "vitest";
import { buildHistoryCsv } from "../domain/historyCsv";
import type { CurrencyCode } from "../domain/money";
import { EMPTY_PEOPLE_DIRECTORY, type PeopleDirectory } from "../domain/people";
import type { Transaction } from "../domain/pokerTypes";
import type { ArchivedGame } from "../domain/sessionHistory";
import { createDefaultGameState } from "../state/seedGame";

const HOUR = 60 * 60 * 1000;

function game(
  id: string,
  name: string,
  startedAt: string,
  players: string[],
  transactions: (ids: string[], at: (hours: number) => string) => Transaction[],
  currencyCode: CurrencyCode = "USD"
): ArchivedGame {
  const state = createDefaultGameState(currencyCode);
  state.localGameId = id;
  state.settings.gameName = name;
  state.players = players.map((player, index) => ({ id: `${id}_p${index}`, name: player, seatIndex: index, isActive: true }));
  const at = (hours: number) => new Date(Date.parse(startedAt) + hours * HOUR).toISOString();
  state.transactions = transactions(state.players.map((player) => player.id), at);
  return { archivedAt: at(48), state };
}

const friday = game("g1", "Friday, \"big\" game", "2026-10-09T19:00:00", ["Alex", "=Blair"], ([alex, blair], at) => [
  { id: "t1", type: "bank_buy_in", toPlayerId: alex, amountCents: 2000, createdAt: at(0) },
  { id: "t2", type: "bank_buy_in", toPlayerId: blair, amountCents: 2000, createdAt: at(0) },
  { id: "t3", type: "bank_cash_out", fromPlayerId: alex, amountCents: 3250, cashOutKind: "final", createdAt: at(3.5) },
  { id: "t4", type: "bank_cash_out", fromPlayerId: blair, amountCents: 750, cashOutKind: "final", createdAt: at(3.5) }
]);

const earlier = game("g0", "Lisbon", "2026-09-01T20:00:00", ["Alex"], ([alex], at) => [
  { id: "t1", type: "bank_buy_in", toPlayerId: alex, amountCents: 5000, createdAt: at(0) }
], "EUR");

describe("Player History CSV", () => {
  it("writes one row per player per game, oldest first, with plain amounts", () => {
    const csv = buildHistoryCsv([friday, earlier], EMPTY_PEOPLE_DIRECTORY);
    expect(csv.split("\r\n")).toEqual([
      "Date,Game,Person,Played as,Currency,Bought in,Cashed out,Net,Hours",
      "2026-09-01,Lisbon,Alex,Alex,EUR,50.00,0.00,-50.00,",
      // Quotes and commas are escaped; a name a spreadsheet would run as a formula is defused.
      '2026-10-09,"Friday, ""big"" game",Alex,Alex,USD,20.00,32.50,12.50,3.50',
      "2026-10-09,\"Friday, \"\"big\"\" game\",'=Blair,'=Blair,USD,20.00,7.50,-12.50,3.50",
      ""
    ]);
  });

  it("names people as Player History does", () => {
    const directory: PeopleDirectory = {
      schemaVersion: 1,
      people: [{ id: "person_a", name: "Alexandra", aliases: ["Alex"], createdAt: "", updatedAt: "" }]
    };
    const [, row] = buildHistoryCsv([earlier], directory).split("\r\n");
    expect(row).toBe("2026-09-01,Lisbon,Alexandra,Alex,EUR,50.00,0.00,-50.00,");
  });

  it("defuses formulas a spreadsheet could run, including full-width ones and after semicolons", () => {
    const names = ["+1", "-1", "@SUM(A1)", "＝1+1", "＋1", "－1", "＠A1", "friendly;=1+1;tail", "Ann-Marie"];
    const tricky = game("g9", "Night", "2026-10-10T19:00:00", names, (ids, at) =>
      ids.map((id, index) => ({ id: `t${index}`, type: "bank_buy_in" as const, toPlayerId: id, amountCents: 100, createdAt: at(0) }))
    );
    const playedAs = buildHistoryCsv([tricky], EMPTY_PEOPLE_DIRECTORY)
      .trimEnd()
      .split("\r\n")
      .slice(1)
      .map((line) => line.split(",")[3]);
    expect(playedAs).toEqual(["'+1", "'-1", "'@SUM(A1)", "'＝1+1", "'＋1", "'－1", "'＠A1", "friendly;'=1+1;tail", "Ann-Marie"]);
  });

  it("is only a header without games", () => {
    expect(buildHistoryCsv([], EMPTY_PEOPLE_DIRECTORY)).toBe("Date,Game,Person,Played as,Currency,Bought in,Cashed out,Net,Hours\r\n");
  });
});
