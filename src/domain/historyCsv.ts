/**
 * Player History as CSV: one row per player per archived game, so a
 * spreadsheet can total, filter, or pivot it. Amounts are plain decimals with
 * the currency in its own column; different currencies are never added up here.
 */
import { buildPlayerSummaries } from "./ledger";
import { gamePlayedAtMs } from "./historyTrends";
import type { PeopleDirectory } from "./people";
import { playerSessionMs } from "./playerHours";
import { groupPlayerHistory, historyRowLabel, type ArchivedGame } from "./sessionHistory";

export const HISTORY_CSV_COLUMNS = [
  "Date",
  "Game",
  "Person",
  "Played as",
  "Currency",
  "Bought in",
  "Cashed out",
  "Net",
  "Hours"
] as const;

/** Characters that make a spreadsheet read a cell as a formula, full-width forms included. */
const FORMULA_START = "=+\\-@\\t\\r＝＋－＠";

/**
 * Text a spreadsheet could run as a formula gets an apostrophe: at the start
 * of the cell, and after any semicolon, since spreadsheets set to semicolon
 * lists split this comma-separated file there (`a;=1+1` would become a
 * formula cell).
 */
function csvText(value: string): string {
  return value
    .replace(new RegExp(`^(?=[${FORMULA_START}])`), "'")
    .replace(new RegExp(`;(?=[${FORMULA_START}])`, "g"), ";'");
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function decimal(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

/** Local calendar date, YYYY-MM-DD. */
function isoDate(ms: number): string {
  const date = new Date(ms);
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, "0"))
    .join("-");
}

/**
 * The games as CSV text (CRLF line ends, header first), oldest game first and
 * each game's players in Player History row order. People are named as their
 * Player History row is.
 */
export function buildHistoryCsv(games: ArchivedGame[], directory: PeopleDirectory): string {
  const rows: Array<{ playedAtMs: number; gameId: string; cells: string[] }> = [];
  const summariesByGame = new Map(
    games.map((game) => [
      game,
      new Map(buildPlayerSummaries(game.state.players, game.state.transactions).map((summary) => [summary.playerId, summary]))
    ])
  );
  for (const group of groupPlayerHistory(games, directory)) {
    const person = historyRowLabel(group);
    for (const entry of group.entries) {
      const { game } = entry;
      const playedAtMs = gamePlayedAtMs(game);
      const summary = summariesByGame.get(game)?.get(entry.playerId);
      const durationMs = playerSessionMs(game.state, entry.playerId);
      rows.push({
        playedAtMs,
        gameId: game.state.localGameId,
        cells: [
          isoDate(playedAtMs),
          csvText(game.state.settings.gameName.trim() || "Untitled game"),
          csvText(person),
          csvText(entry.playerName),
          entry.currencyCode,
          decimal(summary?.bankBuyInsCents ?? 0),
          decimal(summary?.bankCashOutsCents ?? 0),
          decimal(entry.netCents),
          durationMs === null ? "" : (durationMs / 3_600_000).toFixed(2)
        ]
      });
    }
  }
  // Stable sort keeps each game's players in row order.
  rows.sort((left, right) => left.playedAtMs - right.playedAtMs || left.gameId.localeCompare(right.gameId));
  return [HISTORY_CSV_COLUMNS, ...rows.map((row) => row.cells)]
    .map((cells) => cells.map(csvCell).join(","))
    .join("\r\n")
    .concat("\r\n");
}
