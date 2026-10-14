/**
 * Asks the browser to keep this origin's storage when it is under pressure
 * (and, on Safari, exempt it from the 7-day script-writable storage cap).
 * Everything the app owns lives in localStorage, so this is the only lever
 * short of the user exporting a backup.
 */
export const STORAGE_PERSISTENCE_KEY = "poker-tracker:v1:storage-persistence";
export const STORAGE_PERSISTENCE_CHANGED_EVENT = "poker-tracker:storage-persistence-changed";
/** After a denial, wait this long before asking again (browser heuristics can change). */
export const PERSISTENCE_RETRY_MS = 30 * 24 * 60 * 60 * 1000;

export type StoragePersistenceStatus = "granted" | "not_granted" | "unsupported";

type PersistenceRecord = {
  schemaVersion: 1;
  outcome: "granted" | "denied";
  requestedAt: number;
};

type PersistenceManager = Pick<StorageManager, "persist" | "persisted">;

export function getStorageManager(
  nav: { storage?: Partial<StorageManager> } | undefined = typeof navigator === "undefined" ? undefined : navigator
): PersistenceManager | null {
  const storage = nav?.storage;
  return storage && typeof storage.persist === "function" && typeof storage.persisted === "function"
    ? (storage as PersistenceManager)
    : null;
}

function loadRecord(): PersistenceRecord | null {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_PERSISTENCE_KEY) ?? "null") as Partial<PersistenceRecord> | null;
    return value?.schemaVersion === 1 &&
      (value.outcome === "granted" || value.outcome === "denied") &&
      typeof value.requestedAt === "number"
      ? (value as PersistenceRecord)
      : null;
  } catch {
    return null;
  }
}

function saveRecord(outcome: PersistenceRecord["outcome"], requestedAt: number): void {
  try {
    localStorage.setItem(
      STORAGE_PERSISTENCE_KEY,
      JSON.stringify({ schemaVersion: 1, outcome, requestedAt } satisfies PersistenceRecord)
    );
  } catch {
    // Remembering the outcome is best-effort.
  }
}

function announce(status: StoragePersistenceStatus): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(STORAGE_PERSISTENCE_CHANGED_EVENT, { detail: status }));
  }
}

/** Reads the current state without ever prompting the user. */
export async function checkStoragePersistence(
  manager: PersistenceManager | null = getStorageManager()
): Promise<StoragePersistenceStatus> {
  if (!manager) return "unsupported";
  try {
    return (await manager.persisted()) ? "granted" : "not_granted";
  } catch {
    return "not_granted";
  }
}

/** Whether a fresh `persist()` call is allowed by the remembered outcome. */
export function shouldRequestPersistence(now = Date.now()): boolean {
  const record = loadRecord();
  return !record || record.outcome === "granted" || now - record.requestedAt >= PERSISTENCE_RETRY_MS;
}

/**
 * Requests persistent storage at most once per denial window. Firefox may show
 * a permission prompt, so call this from (or shortly after) a user gesture.
 */
export async function requestStoragePersistence(
  manager: PersistenceManager | null = getStorageManager(),
  now = Date.now()
): Promise<StoragePersistenceStatus> {
  const current = await checkStoragePersistence(manager);
  if (current !== "not_granted" || !manager) return current;
  if (!shouldRequestPersistence(now)) return "not_granted";

  let granted = false;
  try {
    granted = await manager.persist();
  } catch {
    granted = false;
  }
  saveRecord(granted ? "granted" : "denied", now);
  const status = granted ? "granted" : "not_granted";
  announce(status);
  return status;
}
