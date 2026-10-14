import type { GameState } from "./pokerTypes";
import { buildPlayerSummaries } from "./ledger";
import { migratePersistedState } from "../state/persistence";
import { validatePersistedState } from "./validation";

export const GAME_ARCHIVE_KEY = "poker-tracker:v1:game-archive";
export const GAME_ARCHIVE_CHANGED_EVENT = "poker-tracker:archive-changed";
const MAX_ARCHIVED_GAMES = 100;

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

export function parseArchivedGames(value: unknown): ArchivedGame[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const candidate = entry as { archivedAt?: unknown; state?: unknown };
    if (typeof candidate.archivedAt !== "string" || !validatePersistedState(candidate.state)) return [];
    return [{ archivedAt: candidate.archivedAt, state: migratePersistedState(candidate.state) }];
  });
}

export function loadArchivedGames(): ArchivedGame[] {
  try {
    return parseArchivedGames(JSON.parse(localStorage.getItem(GAME_ARCHIVE_KEY) ?? "[]") as unknown);
  } catch {
    return [];
  }
}

export function hasArchivedGames(): boolean {
  try {
    const value = JSON.parse(localStorage.getItem(GAME_ARCHIVE_KEY) ?? "[]") as unknown;
    return Array.isArray(value) && value.length > 0;
  } catch {
    return false;
  }
}

function writeArchivedGames(games: ArchivedGame[]): boolean {
  try {
    localStorage.setItem(GAME_ARCHIVE_KEY, JSON.stringify(games.slice(0, MAX_ARCHIVED_GAMES)));
    window.dispatchEvent(new Event(GAME_ARCHIVE_CHANGED_EVENT));
    return true;
  } catch {
    return false;
  }
}

/** Merges restored games into the archive, keeping the newest copy of each game. */
export function mergeArchivedGames(imported: ArchivedGame[]): boolean {
  const byGameId = new Map<string, ArchivedGame>();
  for (const game of [...loadArchivedGames(), ...imported]) {
    const current = byGameId.get(game.state.localGameId);
    if (!current || Date.parse(game.archivedAt) > Date.parse(current.archivedAt)) {
      byGameId.set(game.state.localGameId, game);
    }
  }
  const games = [...byGameId.values()].sort(
    (left, right) => (Date.parse(right.archivedAt) || 0) - (Date.parse(left.archivedAt) || 0)
  );
  return writeArchivedGames(games);
}

export function archiveGame(state: GameState): boolean {
  if (state.transactions.length === 0) return false;
  const existing = loadArchivedGames().filter(
    (game) => game.state.localGameId !== state.localGameId
  );
  return writeArchivedGames([{ archivedAt: new Date().toISOString(), state }, ...existing]);
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
