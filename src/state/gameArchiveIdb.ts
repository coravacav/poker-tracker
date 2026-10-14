/**
 * Player History in IndexedDB: one record per archived game, keyed by its
 * localGameId and indexed by archive time. Records keep the entry exactly as the
 * old localStorage array stored it ({ archivedAt, state }), so entries this
 * build cannot read are stored and moved around untouched.
 */
import { archivedAtMs, type ArchivedGame } from "../domain/sessionHistory";
import { GAME_ARCHIVE_KEY } from "./gameArchiveLocal";
import { fingerprintRaw, quarantineRaw, reasonForInvalid } from "./storageQuarantine";
import { CURRENT_SCHEMA_VERSION } from "./persistence";

export const ARCHIVE_DB_NAME = "poker-tracker";
export const ARCHIVE_DB_VERSION = 1;
export const ARCHIVE_STORE = "archivedGames";
export const ARCHIVED_AT_INDEX = "archivedAt";

export type ArchiveRecord = {
  /** The game's localGameId; entries without a usable one get a stable synthetic id. */
  id: string;
  /** Epoch ms of entry.archivedAt (0 when unparseable); indexed for newest-first reads. */
  archivedAt: number;
  /** Changes on every write so readers can reuse parsed copies of unchanged records. */
  rev: string;
  /** The archived entry as stored: { archivedAt: string, state: GameState } when readable. */
  entry: unknown;
};

/** An entry to write, with the parsed game when this build can read it. */
export type IncomingEntry = { entry: unknown; game: ArchivedGame | null };

/**
 * "replace": a readable incoming game always replaces the stored copy (re-archiving).
 * "newest": the stored copy is kept unless the incoming one is strictly newer
 * (restoring backups and migrating, which may run more than once).
 */
export type WritePolicy = "replace" | "newest";

export type ReadRecord = (record: ArchiveRecord) => ArchivedGame | null;

// --- Thin promise wrapper ----------------------------------------------------

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

function hasArchiveStore(db: IDBDatabase): boolean {
  if (!db.objectStoreNames.contains(ARCHIVE_STORE)) return false;
  try {
    const transaction = db.transaction(ARCHIVE_STORE, "readonly");
    const ok = transaction.objectStore(ARCHIVE_STORE).indexNames.contains(ARCHIVED_AT_INDEX);
    transaction.abort();
    return ok;
  } catch {
    return false;
  }
}

function openRequest(factory: IDBFactory, version: number | undefined): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = version === undefined ? factory.open(ARCHIVE_DB_NAME) : factory.open(ARCHIVE_DB_NAME, version);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ARCHIVE_STORE)) {
        db.createObjectStore(ARCHIVE_STORE, { keyPath: "id" }).createIndex(ARCHIVED_AT_INDEX, "archivedAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });
}

/**
 * Opens the archive database. Rejects when IndexedDB is unusable (some private
 * modes) or does not answer within `timeoutMs`, so callers can fall back.
 */
export async function openArchiveDb(factory: IDBFactory, timeoutMs: number): Promise<IDBDatabase> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const open = (async () => {
    try {
      return await openRequest(factory, ARCHIVE_DB_VERSION);
    } catch (error) {
      // A newer build upgraded the database; its archive store is still readable.
      if ((error as DOMException | null)?.name !== "VersionError") throw error;
      const db = await openRequest(factory, undefined);
      if (hasArchiveStore(db)) return db;
      db.close();
      throw error;
    }
  })();
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new Error("IndexedDB open timed out"));
    }, timeoutMs);
  });
  // A connection that arrives after the timeout is closed rather than leaked.
  void open.then((db) => { if (timedOut) db.close(); }, () => undefined);
  try {
    return await Promise.race([open, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** All records, newest first. */
export async function readArchiveRecords(db: IDBDatabase): Promise<ArchiveRecord[]> {
  const transaction = db.transaction(ARCHIVE_STORE, "readonly");
  const records = await requestResult(
    transaction.objectStore(ARCHIVE_STORE).index(ARCHIVED_AT_INDEX).getAll() as IDBRequest<ArchiveRecord[]>
  );
  return records.reverse();
}

export function countArchiveRecords(db: IDBDatabase): Promise<number> {
  return requestResult(db.transaction(ARCHIVE_STORE, "readonly").objectStore(ARCHIVE_STORE).count());
}

/**
 * Reads every record and applies the planned puts and deletes in one readwrite
 * transaction. Resolves only once the transaction has committed.
 */
export async function writeArchiveRecords(
  db: IDBDatabase,
  incoming: IncomingEntry[],
  policy: WritePolicy,
  cap: number,
  readRecord: ReadRecord
): Promise<void> {
  const transaction = db.transaction(ARCHIVE_STORE, "readwrite");
  const done = transactionDone(transaction);
  const store = transaction.objectStore(ARCHIVE_STORE);
  const request = store.getAll() as IDBRequest<ArchiveRecord[]>;
  request.onsuccess = () => {
    try {
      const plan = planArchiveWrite(request.result, incoming, policy, cap, readRecord);
      for (const id of plan.deletes) store.delete(id);
      for (const record of plan.puts) store.put(record);
    } catch {
      transaction.abort();
    }
  };
  await done;
}

// --- Planning ----------------------------------------------------------------

let revCounter = 0;
export function newRev(): string {
  revCounter += 1;
  return `${Date.now().toString(36)}-${revCounter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const entryKey = (entry: unknown) => JSON.stringify(entry) ?? "undefined";

function entryGameId(entry: unknown): string | null {
  const state = entry && typeof entry === "object" ? (entry as { state?: unknown }).state : undefined;
  const id = state && typeof state === "object" ? (state as { localGameId?: unknown }).localGameId : undefined;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/** Id for an entry stored next to a different entry with the same game id. */
function asideId(id: string, entry: unknown): string {
  return `${id}#${fingerprintRaw(GAME_ARCHIVE_KEY, entryKey(entry))}`;
}

export function recordFor(entry: unknown, game: ArchivedGame | null): ArchiveRecord {
  const id = game?.state.localGameId ?? entryGameId(entry) ?? `unreadable:${fingerprintRaw(GAME_ARCHIVE_KEY, entryKey(entry))}`;
  const archivedAt = entry && typeof entry === "object" ? (entry as { archivedAt?: unknown }).archivedAt : undefined;
  return { id, archivedAt: archivedAtMs(archivedAt), rev: newRev(), entry };
}

/**
 * Decides which records to write. Unreadable entries are never dropped: when an
 * id collides they are kept under a derived id. Only readable games count
 * toward `cap`; the oldest beyond it are removed.
 */
export function planArchiveWrite(
  existing: ArchiveRecord[],
  incoming: IncomingEntry[],
  policy: WritePolicy,
  cap: number,
  readRecord: ReadRecord
): { puts: ArchiveRecord[]; deletes: string[] } {
  const records = new Map(existing.map((record) => [record.id, record]));
  const puts = new Map<string, ArchiveRecord>();
  /** Ids whose new record holds an incoming game this build can read. */
  const readableWrites = new Set<string>();
  const set = (record: ArchiveRecord, readable: boolean) => {
    records.set(record.id, record);
    puts.set(record.id, record);
    if (readable) readableWrites.add(record.id);
    else readableWrites.delete(record.id);
  };

  for (const item of incoming) {
    const record = recordFor(item.entry, item.game);
    const current = records.get(record.id);
    if (!current) {
      set(record, item.game !== null);
      continue;
    }
    if (entryKey(current.entry) === entryKey(item.entry)) continue;
    if (!item.game) {
      const aside = asideId(record.id, item.entry);
      if (!records.has(aside)) set({ ...record, id: aside }, false);
      continue;
    }
    if (!readRecord(current)) {
      set({ ...current, id: asideId(current.id, current.entry) }, false);
      set(record, true);
      continue;
    }
    if (policy === "replace" || record.archivedAt > current.archivedAt) set(record, true);
  }

  const isReadable = (record: ArchiveRecord) =>
    puts.get(record.id) === record ? readableWrites.has(record.id) : readRecord(record) !== null;
  const readable = [...records.values()]
    .filter(isReadable)
    .sort((left, right) => right.archivedAt - left.archivedAt || Number(puts.has(right.id)) - Number(puts.has(left.id)));
  const existingIds = new Set(existing.map((record) => record.id));
  const deletes: string[] = [];
  for (const record of readable.slice(cap)) {
    puts.delete(record.id);
    if (existingIds.has(record.id)) deletes.push(record.id);
  }
  return { puts: [...puts.values()], deletes };
}

// --- Migration ---------------------------------------------------------------

/**
 * Moves the localStorage archive into IndexedDB. The localStorage key is only
 * removed after the IndexedDB transaction commits and only if it still holds
 * the value that was migrated, so a crash or a concurrent writer leaves it in
 * place to be merged again later. Re-running is harmless: unchanged entries are
 * skipped and only strictly newer copies replace stored games. Rejects when the
 * IndexedDB write fails; the localStorage key is then untouched.
 */
export async function migrateLegacyArchive(
  db: IDBDatabase,
  cap: number,
  parseEntry: (entry: unknown) => ArchivedGame | null,
  readRecord: ReadRecord
): Promise<"migrated" | "nothing" | "kept"> {
  let raw: string | null;
  try {
    raw = localStorage.getItem(GAME_ARCHIVE_KEY);
  } catch {
    return "nothing";
  }
  if (raw === null) return "nothing";

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    // Unreadable text: drop it only once a copy is kept for the user.
    if (quarantineRaw(GAME_ARCHIVE_KEY, raw, "unreadable")) removeIfUnchanged(raw);
    return "kept";
  }
  if (!Array.isArray(value)) {
    if (quarantineRaw(GAME_ARCHIVE_KEY, raw, reasonForInvalid(value, CURRENT_SCHEMA_VERSION))) {
      removeIfUnchanged(raw);
    }
    return "kept";
  }

  const incoming = value.map((entry: unknown) => ({ entry, game: parseEntry(entry) }));
  await writeArchiveRecords(db, incoming, "newest", cap, readRecord);
  removeIfUnchanged(raw);
  return "migrated";
}

function removeIfUnchanged(raw: string): void {
  try {
    if (localStorage.getItem(GAME_ARCHIVE_KEY) === raw) localStorage.removeItem(GAME_ARCHIVE_KEY);
  } catch {
    // The next load will see the same value and skip everything already stored.
  }
}
