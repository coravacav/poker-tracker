import type { GameState } from "./pokerTypes";
import { buildPlayerSummaries } from "./ledger";
import { migratePersistedState } from "../state/persistence";
import { validatePersistedState } from "./validation";

/** Storage and change notifications live in state/gameArchive.ts; this module stays pure. */
export type ArchivedGame = {
  archivedAt: string;
  state: GameState;
};

export type PlayerHistoryStat = {
  name: string;
  games: number;
  totalNetCents: number;
  averageNetCents: number;
  biggestWinCents: number;
  biggestLossCents: number;
};

/** Validates and migrates one stored archive entry; null when this build cannot read it. */
export function parseArchivedEntry(entry: unknown): ArchivedGame | null {
  if (!entry || typeof entry !== "object") return null;
  const candidate = entry as { archivedAt?: unknown; state?: unknown };
  if (typeof candidate.archivedAt !== "string" || !validatePersistedState(candidate.state)) return null;
  try {
    return { archivedAt: candidate.archivedAt, state: migratePersistedState(candidate.state) };
  } catch {
    return null;
  }
}

export function parseArchivedGames(value: unknown): ArchivedGame[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => parseArchivedEntry(entry) ?? []);
}

/** Epoch milliseconds of an archive timestamp; 0 when it is missing or unparseable. */
export function archivedAtMs(archivedAt: unknown): number {
  return typeof archivedAt === "string" ? Date.parse(archivedAt) || 0 : 0;
}

export function buildPlayerHistoryStats(games: ArchivedGame[]): PlayerHistoryStat[] {
  const values = new Map<string, { name: string; results: number[] }>();
  for (const game of games) {
    const summaryById = new Map(
      buildPlayerSummaries(game.state.players, game.state.transactions)
        .map((summary) => [summary.playerId, summary])
    );
    for (const player of game.state.players) {
      const result = summaryById.get(player.id)?.netCents ?? 0;
      const key = player.name.trim().toLocaleLowerCase();
      if (!key) continue;
      const current = values.get(key) ?? { name: player.name.trim(), results: [] };
      current.results.push(result);
      values.set(key, current);
    }
  }

  return [...values.values()].map(({ name, results }) => {
    const totalNetCents = results.reduce((total, result) => total + result, 0);
    return {
      name,
      games: results.length,
      totalNetCents,
      averageNetCents: Math.round(totalNetCents / results.length),
      biggestWinCents: Math.max(...results),
      biggestLossCents: Math.min(...results)
    };
  }).sort((left, right) => right.totalNetCents - left.totalNetCents);
}
