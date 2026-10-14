import type { GameState } from "./pokerTypes";
import { buildPlayerSummaries } from "./ledger";
import { CURRENT_SCHEMA_VERSION, migratePersistedState } from "../state/persistence";
import {
  listQuarantined,
  quarantineEntries,
  quarantineRaw,
  reasonForInvalid,
  releaseQuarantined
} from "../state/storageQuarantine";
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

function parseArchivedEntry(entry: unknown): ArchivedGame | null {
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

type StoredArchive = {
  games: ArchivedGame[];
  /** Entries this build cannot read; written back untouched so a newer build still sees them. */
  unreadable: unknown[];
  /** False when the stored archive is unreadable and no copy of it could be kept. */
  safeToWrite: boolean;
};

const entryState = (entry: unknown) =>
  entry && typeof entry === "object" ? (entry as { state?: unknown }).state : undefined;

/** Drops kept copies of archive entries that are still stored and now read cleanly. */
function releaseReadableEntryCopies(storedEntries: unknown[]): void {
  const copies = listQuarantined().filter(
    (record) => record.sourceKey === GAME_ARCHIVE_KEY && record.scope === "entries"
  );
  if (copies.length === 0) return;
  const stored = new Set(storedEntries.map((entry) => JSON.stringify(entry)));
  for (const copy of copies) {
    try {
      const entries = JSON.parse(copy.raw) as unknown;
      if (
        Array.isArray(entries) &&
        entries.every((entry) => stored.has(JSON.stringify(entry)) && parseArchivedEntry(entry))
      ) {
        releaseQuarantined(copy.id);
      }
    } catch {
      // Leave copies we cannot interpret for the user to download.
    }
  }
}

function readStoredArchive(): StoredArchive {
  if (typeof localStorage === "undefined") return { games: [], unreadable: [], safeToWrite: false };
  let raw: string | null;
  try {
    raw = localStorage.getItem(GAME_ARCHIVE_KEY);
  } catch {
    return { games: [], unreadable: [], safeToWrite: false };
  }
  if (raw === null) return { games: [], unreadable: [], safeToWrite: true };

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { games: [], unreadable: [], safeToWrite: quarantineRaw(GAME_ARCHIVE_KEY, raw, "unreadable") };
  }
  if (!Array.isArray(value)) {
    return {
      games: [],
      unreadable: [],
      safeToWrite: quarantineRaw(GAME_ARCHIVE_KEY, raw, reasonForInvalid(value, CURRENT_SCHEMA_VERSION))
    };
  }

  const games: ArchivedGame[] = [];
  const unreadable: unknown[] = [];
  for (const entry of value) {
    const game = parseArchivedEntry(entry);
    if (game) games.push(game);
    else unreadable.push(entry);
  }
  if (unreadable.length > 0) {
    quarantineEntries(GAME_ARCHIVE_KEY, unreadable, CURRENT_SCHEMA_VERSION, entryState);
  } else {
    releaseReadableEntryCopies(value);
  }
  return { games, unreadable, safeToWrite: true };
}

export function loadArchivedGames(): ArchivedGame[] {
  return readStoredArchive().games;
}

export function hasArchivedGames(): boolean {
  try {
    const value = JSON.parse(localStorage.getItem(GAME_ARCHIVE_KEY) ?? "[]") as unknown;
    return Array.isArray(value) && value.length > 0;
  } catch {
    return false;
  }
}

function writeArchivedGames(archive: StoredArchive, games: ArchivedGame[]): boolean {
  if (!archive.safeToWrite) return false;
  try {
    localStorage.setItem(
      GAME_ARCHIVE_KEY,
      JSON.stringify([...games.slice(0, MAX_ARCHIVED_GAMES), ...archive.unreadable])
    );
    window.dispatchEvent(new Event(GAME_ARCHIVE_CHANGED_EVENT));
    return true;
  } catch {
    return false;
  }
}

/** Merges restored games into the archive, keeping the newest copy of each game. */
export function mergeArchivedGames(imported: ArchivedGame[]): boolean {
  const byGameId = new Map<string, ArchivedGame>();
  const archive = readStoredArchive();
  for (const game of [...archive.games, ...imported]) {
    const current = byGameId.get(game.state.localGameId);
    if (!current || Date.parse(game.archivedAt) > Date.parse(current.archivedAt)) {
      byGameId.set(game.state.localGameId, game);
    }
  }
  const games = [...byGameId.values()].sort(
    (left, right) => (Date.parse(right.archivedAt) || 0) - (Date.parse(left.archivedAt) || 0)
  );
  return writeArchivedGames(archive, games);
}

export function archiveGame(state: GameState): boolean {
  if (state.transactions.length === 0) return false;
  const archive = readStoredArchive();
  const existing = archive.games.filter((game) => game.state.localGameId !== state.localGameId);
  return writeArchivedGames(archive, [{ archivedAt: new Date().toISOString(), state }, ...existing]);
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
