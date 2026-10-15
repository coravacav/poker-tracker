/**
 * Pure data shaping for Player History stats over time: when a game was
 * played, date-range filtering, and per-person series in one currency.
 * Amounts in different currencies are never combined.
 */
import type { CurrencyCode } from "./money";
import type { PeopleDirectory } from "./people";
import {
  archivedAtMs,
  currencyResult,
  groupPlayerHistory,
  historyMainCurrency,
  type ArchivedGame,
  type PlayerCurrencyResult
} from "./sessionHistory";

export type HistoryRange = "30d" | "90d" | "1y" | "all";

export const HISTORY_RANGES: ReadonlyArray<{ value: HistoryRange; label: string }> = [
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "1y", label: "Year" },
  { value: "all", label: "All time" }
];

const RANGE_DAYS: Record<Exclude<HistoryRange, "all">, number> = { "30d": 30, "90d": 90, "1y": 365 };
const DAY_MS = 24 * 60 * 60 * 1000;

/** Most people drawn at once on the over-time chart (one per categorical color). */
export const MAX_CHART_SERIES = 8;
/** People shown on the over-time chart until the user picks others. */
export const DEFAULT_CHART_SERIES = 5;

/**
 * When a game was played: its first transaction (the first buy-in), which is
 * when play started. Archive time is when the *next* game was started, and the
 * game's own creation time is usually when the *previous* game was archived, so
 * either can be days off. Falls back to creation time, then archive time, for
 * games without readable transaction times.
 */
export function gamePlayedAtMs(game: ArchivedGame): number {
  let earliest = Number.POSITIVE_INFINITY;
  for (const transaction of game.state.transactions) {
    const ms = Date.parse(transaction.createdAt);
    if (Number.isFinite(ms) && ms < earliest) earliest = ms;
  }
  if (earliest !== Number.POSITIVE_INFINITY) return earliest;
  return Date.parse(game.state.settings.createdAt) || archivedAtMs(game.archivedAt);
}

/** Start of the range in epoch ms, or null for all time. */
export function rangeStartMs(range: HistoryRange, nowMs: number): number | null {
  return range === "all" ? null : nowMs - RANGE_DAYS[range] * DAY_MS;
}

/** Games played inside the range (all games for "all"). */
export function filterGamesByRange(games: ArchivedGame[], range: HistoryRange, nowMs: number): ArchivedGame[] {
  const start = rangeStartMs(range, nowMs);
  return start === null ? games : games.filter((game) => gamePlayedAtMs(game) >= start);
}

/** Currencies used by the games: the main currency first, then by games played, then by code. */
export function historyCurrencies(games: ArchivedGame[]): CurrencyCode[] {
  if (games.length === 0) return [];
  const main = historyMainCurrency(games);
  const counts = new Map<CurrencyCode, number>();
  for (const game of games) {
    const code = game.state.settings.currencyCode;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(
      ([leftCode, left], [rightCode, right]) =>
        Number(rightCode === main) - Number(leftCode === main) || right - left || leftCode.localeCompare(rightCode)
    )
    .map(([code]) => code);
}

export type PersonGameResult = {
  gameId: string;
  gameName: string;
  playedAtMs: number;
  netCents: number;
};

/** One Player History row's games in a single currency, oldest first. */
export type PersonTimeline = {
  /** Same key as the Player History row (PlayerHistoryStat.key). */
  key: string;
  name: string;
  results: PersonGameResult[];
};

/**
 * Each person's games in one currency, oldest first. People are ordered by
 * games played in that currency, then by name. Games in other currencies are
 * left out, so nothing is ever summed across currencies.
 */
export function buildPersonTimelines(
  games: ArchivedGame[],
  directory: PeopleDirectory,
  currencyCode: CurrencyCode
): PersonTimeline[] {
  return groupPlayerHistory(games, directory)
    .map(({ key, name, entries }): PersonTimeline => ({
      key,
      name,
      results: entries
        .filter((entry) => entry.currencyCode === currencyCode)
        .map((entry) => ({
          gameId: entry.game.state.localGameId,
          gameName: entry.game.state.settings.gameName,
          playedAtMs: gamePlayedAtMs(entry.game),
          netCents: entry.netCents
        }))
        .sort((left, right) => left.playedAtMs - right.playedAtMs || left.gameId.localeCompare(right.gameId))
    }))
    .filter((timeline) => timeline.results.length > 0)
    .sort((left, right) => right.results.length - left.results.length || left.name.localeCompare(right.name));
}

export type CumulativePoint = PersonGameResult & { cumulativeCents: number };

/** Running total after each game, in the (oldest-first) order given. */
export function cumulativeSeries(results: PersonGameResult[]): CumulativePoint[] {
  let total = 0;
  return results.map((result) => {
    total += result.netCents;
    return { ...result, cumulativeCents: total };
  });
}

export type PersonResultSummary = PlayerCurrencyResult & {
  wins: number;
  /** Share of games with a net win, 0–1. */
  winRate: number;
};

/** Totals for one person's games in one currency; null when there are none. */
export function summarizePersonResults(
  currencyCode: CurrencyCode,
  results: PersonGameResult[]
): PersonResultSummary | null {
  if (results.length === 0) return null;
  const wins = results.filter((result) => result.netCents > 0).length;
  return {
    ...currencyResult(currencyCode, results.map((result) => result.netCents)),
    wins,
    winRate: wins / results.length
  };
}

/**
 * Chart colors are slots 0..MAX_CHART_SERIES-1, held by a person while they are
 * shown. Toggling someone off frees their slot without repainting anyone else,
 * and toggling someone on takes the first free slot.
 */
export type SeriesSlots = Array<string | null>;

export function initialSeriesSlots(timelines: PersonTimeline[], count = DEFAULT_CHART_SERIES): SeriesSlots {
  return timelines.slice(0, Math.min(count, MAX_CHART_SERIES)).map((timeline) => timeline.key);
}

/** Shows or hides a person. Unchanged when showing someone while every slot is taken. */
export function toggleSeriesSlot(slots: SeriesSlots, key: string): SeriesSlots {
  const at = slots.indexOf(key);
  if (at >= 0) {
    const next = slots.slice();
    next[at] = null;
    // Trailing free slots carry nothing; trimming keeps the next pick in the lowest free slot.
    while (next.length > 0 && next[next.length - 1] === null) next.pop();
    return next;
  }
  const free = slots.indexOf(null);
  if (free >= 0) {
    const next = slots.slice();
    next[free] = key;
    return next;
  }
  return slots.length < MAX_CHART_SERIES ? [...slots, key] : slots;
}
