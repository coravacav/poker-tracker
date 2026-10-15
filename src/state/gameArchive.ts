/**
 * Player History storage. Games live in IndexedDB (one record per game); the
 * old single localStorage key is migrated once and remains the fallback when
 * IndexedDB is unavailable. Parsed games are cached in memory and the cache is
 * invalidated on local writes and on changes from other tabs.
 */
import type { GameState } from "../domain/pokerTypes";
import { archiveEntry, parseArchivedEntry, type ArchivedGame } from "../domain/sessionHistory";
import {
  countArchiveRecords,
  migrateLegacyArchive,
  openArchiveDb,
  readArchiveRecords,
  updateArchiveRecords,
  writeArchiveRecords,
  type ArchiveRecord,
  type IncomingEntry,
  type WritePolicy
} from "./gameArchiveIdb";
import {
  GAME_ARCHIVE_KEY,
  archiveLocalGame,
  hasLocalArchivedGames,
  mergeLocalArchivedGames,
  quarantineUnreadableEntries,
  readLocalArchive,
  releaseReadableEntryCopies,
  updateLocalArchivedGames
} from "./gameArchiveLocal";
import { linkGameToPeople } from "./peopleStore";
import { QUARANTINE_CHANGED_EVENT } from "./storageQuarantine";

export { GAME_ARCHIVE_KEY, MAX_LOCAL_ARCHIVED_GAMES } from "./gameArchiveLocal";
export const GAME_ARCHIVE_CHANGED_EVENT = "poker-tracker:archive-changed";
/**
 * Games kept in IndexedDB. Raised from the localStorage limit of 100 now that
 * the archive no longer competes for the ~5 MB localStorage quota; at roughly a
 * game a week this is about ten years, while reads stay fast.
 */
export const MAX_ARCHIVED_GAMES = 500;
/** Other tabs are told about archive writes on this channel (or via ARCHIVE_PING_KEY). */
export const ARCHIVE_CHANNEL_NAME = "poker-tracker:game-archive";
export const ARCHIVE_PING_KEY = "poker-tracker:v1:game-archive-changed";
const OPEN_TIMEOUT_MS = 5000;

export type ArchiveBackend = "indexeddb" | "localStorage";
type Backend = { kind: "indexeddb"; db: IDBDatabase } | { kind: "localStorage" };

let backendPromise: Promise<Backend> | null = null;
let openedDb: IDBDatabase | null = null;
let migration: Promise<boolean> = Promise.resolve(true);
type Snapshot = { promise: Promise<ArchivedGame[]>; value?: ArchivedGame[] };
let snapshot: Snapshot | null = null;
/** Parsed copy of each record, reused while its rev is unchanged. */
const parsedRecords = new Map<string, { rev: string; game: ArchivedGame | null }>();
let channel: BroadcastChannel | null = null;
let listening = false;

function readRecord(record: ArchiveRecord): ArchivedGame | null {
  const cached = parsedRecords.get(record.id);
  if (cached && cached.rev === record.rev) return cached.game;
  const game = parseArchivedEntry(record.entry);
  parsedRecords.set(record.id, { rev: record.rev, game });
  return game;
}

/** Resolves false when the IndexedDB write failed and the localStorage archive was left in place. */
function migrateLegacy(db: IDBDatabase): Promise<boolean> {
  migration = migration
    .then(() => migrateLegacyArchive(db, MAX_ARCHIVED_GAMES, parseArchivedEntry, readRecord))
    .then(() => true, () => false);
  return migration;
}

async function openBackend(): Promise<Backend> {
  const factory = typeof indexedDB === "undefined" ? undefined : indexedDB;
  if (!factory) return { kind: "localStorage" };
  let db: IDBDatabase;
  try {
    db = await openArchiveDb(factory, OPEN_TIMEOUT_MS);
  } catch {
    return { kind: "localStorage" };
  }
  openedDb = db;
  db.onversionchange = () => {
    // Let another tab upgrade the database; the next access reopens it.
    db.close();
    if (openedDb === db) {
      openedDb = null;
      backendPromise = null;
    }
  };
  if (!(await migrateLegacy(db))) {
    // Keep using the old archive this session rather than show it empty; the
    // next load tries the move again and merges anything written meanwhile.
    db.close();
    openedDb = null;
    return { kind: "localStorage" };
  }
  return { kind: "indexeddb", db };
}

function getBackend(): Promise<Backend> {
  listenForOtherTabs();
  backendPromise ??= openBackend();
  return backendPromise;
}

/** Which storage Player History is using in this session. */
export async function getArchiveBackend(): Promise<ArchiveBackend> {
  return (await getBackend()).kind;
}

function invalidate(): void {
  snapshot = null;
}

function announceLocally(): void {
  invalidate();
  if (typeof window !== "undefined") window.dispatchEvent(new Event(GAME_ARCHIVE_CHANGED_EVENT));
}

function announceToOtherTabs(kind: Backend["kind"]): void {
  // localStorage writes already raise "storage" events in other tabs.
  if (kind === "localStorage") return;
  if (channel) {
    channel.postMessage("changed");
    return;
  }
  try {
    localStorage.setItem(ARCHIVE_PING_KEY, `${Date.now()}:${Math.random()}`);
  } catch {
    // Other tabs will catch up on their next reload.
  }
}

function listenForOtherTabs(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;
  if (typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel(ARCHIVE_CHANNEL_NAME);
    channel.onmessage = announceLocally;
    (channel as { unref?: () => void }).unref?.();
  }
  window.addEventListener("storage", handleStorageEvent);
}

function handleStorageEvent(event: StorageEvent): void {
  if (event.key === ARCHIVE_PING_KEY || event.key === null) {
    announceLocally();
  } else if (event.key === GAME_ARCHIVE_KEY) {
    // In IndexedDB mode this is an older build in another tab writing the old key.
    void getBackend()
      .then((backend) => (backend.kind === "indexeddb" ? migrateLegacy(backend.db) : undefined))
      .then(announceLocally);
  }
}

async function readGames(): Promise<ArchivedGame[]> {
  const backend = await getBackend();
  if (backend.kind === "localStorage") return readLocalArchive().games;

  await migration;
  const records = await readArchiveRecords(backend.db);
  const live = new Set<string>();
  const byGameId = new Map<string, ArchivedGame>();
  const unreadable: unknown[] = [];
  for (const record of records) {
    live.add(record.id);
    const game = readRecord(record);
    if (!game) {
      unreadable.push(record.entry);
      continue;
    }
    // A copy kept aside under a derived id can become readable after an update;
    // records arrive newest first, so the first copy of each game wins.
    if (!byGameId.has(game.state.localGameId)) byGameId.set(game.state.localGameId, game);
  }
  for (const id of parsedRecords.keys()) if (!live.has(id)) parsedRecords.delete(id);

  if (unreadable.length > 0) quarantineUnreadableEntries(unreadable);
  else releaseReadableEntryCopies(records.map((record) => record.entry));
  return [...byGameId.values()];
}

/** Archived games, newest first. Repeated calls reuse the cached result until the archive changes. */
export function loadArchivedGames(): Promise<ArchivedGame[]> {
  if (snapshot) return snapshot.promise;
  const current: Snapshot = { promise: Promise.resolve([]) };
  current.promise = readGames().then(
    (games) => {
      if (snapshot === current) current.value = games;
      // Reading may keep or release copies of entries this build cannot read.
      if (typeof window !== "undefined") window.dispatchEvent(new Event(QUARANTINE_CHANGED_EVENT));
      return games;
    },
    (): ArchivedGame[] => {
      if (snapshot === current) snapshot = null;
      return [];
    }
  );
  snapshot = current;
  return current.promise;
}

/** The cached games when they are already loaded, so remounting views does not flash. */
export function peekArchivedGames(): ArchivedGame[] | undefined {
  return snapshot?.value;
}

/** Whether anything (readable or not) is stored in Player History. */
export async function hasArchivedGames(): Promise<boolean> {
  const cached = peekArchivedGames();
  if (cached && cached.length > 0) return true;
  const backend = await getBackend();
  if (backend.kind === "localStorage") return hasLocalArchivedGames();
  try {
    await migration;
    return (await countArchiveRecords(backend.db)) > 0;
  } catch {
    return false;
  }
}

/** JSON round-trip: stores the same shape the old localStorage archive held. */
function toEntry(game: ArchivedGame): IncomingEntry {
  return { entry: archiveEntry(game), game };
}

/**
 * Runs a write against the current backend; when it reports a change, this
 * tab's cache is dropped and other tabs are told.
 */
async function commit(
  writeIdb: (db: IDBDatabase) => Promise<boolean>,
  writeLocal: () => boolean
): Promise<boolean> {
  let backend: Backend;
  try {
    backend = await getBackend();
  } catch {
    return false;
  }
  let ok: boolean;
  if (backend.kind === "localStorage") {
    ok = writeLocal();
  } else {
    try {
      await migration;
      ok = await writeIdb(backend.db);
    } catch {
      ok = false;
    }
  }
  if (ok) {
    announceLocally();
    announceToOtherTabs(backend.kind);
  }
  return ok;
}

function write(games: ArchivedGame[], policy: WritePolicy, writeLocal: () => boolean): Promise<boolean> {
  return commit(async (db) => {
    await writeArchiveRecords(db, games.map(toEntry), policy, MAX_ARCHIVED_GAMES, readRecord);
    return true;
  }, writeLocal);
}

/**
 * Saves a played game to Player History, replacing an earlier copy of the same
 * game. Its players are linked to people first (new names become new people).
 */
export async function archiveGame(state: GameState): Promise<boolean> {
  if (state.transactions.length === 0) return false;
  const archivedAt = new Date().toISOString();
  const linked = linkGameToPeople(state);
  return write([{ archivedAt, state: linked }], "replace", () => archiveLocalGame(linked, archivedAt));
}

/** Merges restored games into the archive, keeping the newest copy of each game. */
export async function mergeArchivedGames(imported: ArchivedGame[]): Promise<boolean> {
  return write(imported, "newest", () => mergeLocalArchivedGames(imported));
}

/**
 * Changes games already in Player History (for example relinking a player to
 * another person). Only the listed games are rewritten, each with `editedAt`
 * set so restoring an older backup does not undo the change. Resolves with
 * the number of games changed, or null when the change could not be saved.
 */
export async function updateArchivedGames(
  gameIds: string[],
  update: (game: ArchivedGame) => ArchivedGame | null,
  now = new Date()
): Promise<number | null> {
  const ids = new Set(gameIds);
  const stamped = (game: ArchivedGame): ArchivedGame | null => {
    const next = update(game);
    return next ? { ...next, editedAt: now.toISOString() } : null;
  };
  let changed: number | null = null;
  const announced = await commit(
    async (db) => {
      changed = await updateArchiveRecords(db, ids, stamped, readRecord);
      return changed > 0;
    },
    () => {
      changed = updateLocalArchivedGames(ids, stamped);
      return (changed ?? 0) > 0;
    }
  );
  return announced ? changed : changed === 0 ? 0 : null;
}

/** Test helper: forgets the open database, caches, and listeners. */
export function resetGameArchiveForTests(): void {
  openedDb?.close();
  openedDb = null;
  backendPromise = null;
  migration = Promise.resolve(true);
  snapshot = null;
  parsedRecords.clear();
  channel?.close();
  channel = null;
  if (listening && typeof window !== "undefined") window.removeEventListener("storage", handleStorageEvent);
  listening = false;
}
