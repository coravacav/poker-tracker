/**
 * The original Player History storage: one localStorage key holding a JSON
 * array of archived games. It is now only the fallback for browsers without a
 * usable IndexedDB, and the source of the one-time migration into IndexedDB.
 */
import type { GameState } from "../domain/pokerTypes";
import { archivedAtMs, parseArchivedEntry, type ArchivedGame } from "../domain/sessionHistory";
import { CURRENT_SCHEMA_VERSION } from "./persistence";
import {
  QUARANTINE_PREFIX,
  fingerprintRaw,
  listQuarantined,
  quarantineEntries,
  quarantineRaw,
  reasonForInvalid,
  releaseQuarantined
} from "./storageQuarantine";

export const GAME_ARCHIVE_KEY = "poker-tracker:v1:game-archive";
/** localStorage shares a ~5 MB quota with everything else, so the fallback keeps fewer games. */
export const MAX_LOCAL_ARCHIVED_GAMES = 100;

const entryState = (entry: unknown) =>
  entry && typeof entry === "object" ? (entry as { state?: unknown }).state : undefined;

function archiveEntryCopies() {
  return listQuarantined().filter(
    (record) => record.sourceKey === GAME_ARCHIVE_KEY && record.scope === "entries"
  );
}

function parseCopyEntries(raw: string): unknown[] | null {
  try {
    const entries = JSON.parse(raw) as unknown;
    return Array.isArray(entries) ? entries : null;
  } catch {
    return null;
  }
}

/** Drops kept copies of archive entries that are still stored and now read cleanly. */
export function releaseReadableEntryCopies(storedEntries: unknown[]): void {
  const copies = archiveEntryCopies();
  if (copies.length === 0) return;
  const stored = new Set(storedEntries.map((entry) => JSON.stringify(entry)));
  for (const copy of copies) {
    const entries = parseCopyEntries(copy.raw);
    // Leave copies we cannot interpret for the user to download.
    if (entries?.every((entry) => stored.has(JSON.stringify(entry)) && parseArchivedEntry(entry))) {
      releaseQuarantined(copy.id);
    }
  }
}

/**
 * Keeps one copy of the archive entries this build skipped. Older copies whose
 * entries are all part of the new copy are released so the same games are not
 * reported twice (for example after the archive moved and its order changed).
 */
export function quarantineUnreadableEntries(entries: unknown[]): boolean {
  if (entries.length === 0) return true;
  const kept = quarantineEntries(GAME_ARCHIVE_KEY, entries, CURRENT_SCHEMA_VERSION, entryState);
  const currentId = `${QUARANTINE_PREFIX}${fingerprintRaw(`${GAME_ARCHIVE_KEY}#entries`, JSON.stringify(entries))}`;
  const copies = archiveEntryCopies();
  if (!copies.some((copy) => copy.id === currentId)) return kept;
  const current = new Set(entries.map((entry) => JSON.stringify(entry)));
  for (const copy of copies) {
    if (copy.id === currentId) continue;
    if (parseCopyEntries(copy.raw)?.every((entry) => current.has(JSON.stringify(entry)))) {
      releaseQuarantined(copy.id);
    }
  }
  return kept;
}

type StoredArchive = {
  games: ArchivedGame[];
  /** Entries this build cannot read; written back untouched so a newer build still sees them. */
  unreadable: unknown[];
  /** False when the stored archive is unreadable and no copy of it could be kept. */
  safeToWrite: boolean;
};

export function readLocalArchive(): StoredArchive {
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
  if (unreadable.length > 0) quarantineUnreadableEntries(unreadable);
  else releaseReadableEntryCopies(value);
  return { games, unreadable, safeToWrite: true };
}

export function hasLocalArchivedGames(): boolean {
  try {
    const value = JSON.parse(localStorage.getItem(GAME_ARCHIVE_KEY) ?? "[]") as unknown;
    return Array.isArray(value) && value.length > 0;
  } catch {
    return false;
  }
}

function writeLocalArchive(archive: StoredArchive, games: ArchivedGame[]): boolean {
  if (!archive.safeToWrite) return false;
  try {
    localStorage.setItem(
      GAME_ARCHIVE_KEY,
      JSON.stringify([...games.slice(0, MAX_LOCAL_ARCHIVED_GAMES), ...archive.unreadable])
    );
    return true;
  } catch {
    return false;
  }
}

/** Merges restored games into the archive, keeping the newest copy of each game. */
export function mergeLocalArchivedGames(imported: ArchivedGame[]): boolean {
  const byGameId = new Map<string, ArchivedGame>();
  const archive = readLocalArchive();
  for (const game of [...archive.games, ...imported]) {
    const current = byGameId.get(game.state.localGameId);
    if (!current || Date.parse(game.archivedAt) > Date.parse(current.archivedAt)) {
      byGameId.set(game.state.localGameId, game);
    }
  }
  const games = [...byGameId.values()].sort(
    (left, right) => archivedAtMs(right.archivedAt) - archivedAtMs(left.archivedAt)
  );
  return writeLocalArchive(archive, games);
}

export function archiveLocalGame(state: GameState, archivedAt: string): boolean {
  const archive = readLocalArchive();
  const existing = archive.games.filter((game) => game.state.localGameId !== state.localGameId);
  return writeLocalArchive(archive, [{ archivedAt, state }, ...existing]);
}
