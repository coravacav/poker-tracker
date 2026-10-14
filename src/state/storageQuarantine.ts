/**
 * Keeps a copy of stored data this build cannot read, before anything gets a
 * chance to overwrite it. The usual cause is an older cached build opening data
 * written by a newer one, so copies stay until the user downloads or deletes them.
 *
 * Each copy lives under its own key derived from a fingerprint of the raw value,
 * which makes repeat loads of the same unreadable value a no-op. Copies are
 * capped per source key, and a copy that does not fit in storage is kept in
 * memory for this session so it can still be downloaded.
 */

export const QUARANTINE_PREFIX = "poker-tracker:v1:corrupt-backup:";
export const QUARANTINE_DISMISSED_KEY = "poker-tracker:v1:corrupt-backup-dismissed";
export const QUARANTINE_CHANGED_EVENT = "poker-tracker:corrupt-backup-changed";
/** Copies kept per source key and scope; older ones are dropped. */
export const MAX_COPIES_PER_SOURCE = 2;
const MAX_DISMISSED = 50;

export type QuarantineReason = "unreadable" | "invalid" | "newer_version";
/** "value": the whole stored value. "entries": a JSON array of list entries that were skipped. */
export type QuarantineScope = "value" | "entries";

export type QuarantineRecord = {
  id: string;
  sourceKey: string;
  scope: QuarantineScope;
  reason: QuarantineReason;
  detectedAt: string;
  entryCount?: number;
  raw: string;
  /** False when storage was full and the copy only exists for this session. */
  persisted: boolean;
};

const unsavedCopies = new Map<string, QuarantineRecord>();

function storage(): Storage | undefined {
  return typeof localStorage === "undefined" ? undefined : localStorage;
}

/** Stable, compact fingerprint of a raw stored value (53-bit hash plus length). */
export function fingerprintRaw(sourceKey: string, raw: string): string {
  const text = `${sourceKey}\u0000${raw}`;
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${text.length.toString(36)}-${(h2 >>> 0).toString(36)}${(h1 >>> 0).toString(36)}`;
}

/** "newer_version" when the value carries a schemaVersion above what this build understands. */
export function reasonForInvalid(value: unknown, currentSchemaVersion: number): QuarantineReason {
  const version =
    value && typeof value === "object" ? (value as { schemaVersion?: unknown }).schemaVersion : undefined;
  return typeof version === "number" && version > currentSchemaVersion ? "newer_version" : "invalid";
}

function readDismissed(store: Storage): string[] {
  try {
    const value = JSON.parse(store.getItem(QUARANTINE_DISMISSED_KEY) ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function parseRecord(id: string, raw: string | null): QuarantineRecord | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as Partial<QuarantineRecord>;
    if (
      typeof value.sourceKey !== "string" ||
      typeof value.raw !== "string" ||
      typeof value.detectedAt !== "string"
    ) {
      return null;
    }
    return {
      id,
      sourceKey: value.sourceKey,
      scope: value.scope === "entries" ? "entries" : "value",
      reason:
        value.reason === "unreadable" || value.reason === "newer_version" ? value.reason : "invalid",
      detectedAt: value.detectedAt,
      ...(typeof value.entryCount === "number" ? { entryCount: value.entryCount } : {}),
      raw: value.raw,
      persisted: true
    };
  } catch {
    return null;
  }
}

function listPersisted(store: Storage): QuarantineRecord[] {
  const ids: string[] = [];
  try {
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (key?.startsWith(QUARANTINE_PREFIX)) ids.push(key);
    }
    return ids.flatMap((id) => parseRecord(id, store.getItem(id)) ?? []);
  } catch {
    return [];
  }
}

function newestFirst(left: QuarantineRecord, right: QuarantineRecord): number {
  return (Date.parse(right.detectedAt) || 0) - (Date.parse(left.detectedAt) || 0);
}

/** All kept copies, newest first, including copies that only exist in memory. */
export function listQuarantined(): QuarantineRecord[] {
  const store = storage();
  const persisted = store ? listPersisted(store) : [];
  const persistedIds = new Set(persisted.map((record) => record.id));
  return [
    ...persisted,
    ...[...unsavedCopies.values()].filter((record) => !persistedIds.has(record.id))
  ].sort(newestFirst);
}

/**
 * Keeps a copy of `raw` before callers fall back to defaults that may later
 * overwrite it. Returns true when the data is safe to overwrite: a durable copy
 * exists (now or from an earlier load) or the user already deleted this copy.
 */
export function quarantineRaw(
  sourceKey: string,
  raw: string,
  reason: QuarantineReason,
  options: { scope?: QuarantineScope; entryCount?: number; now?: Date } = {}
): boolean {
  const store = storage();
  if (!store) return false;
  const scope = options.scope ?? "value";
  const fingerprint = fingerprintRaw(`${sourceKey}#${scope}`, raw);
  const id = `${QUARANTINE_PREFIX}${fingerprint}`;

  try {
    if (store.getItem(id) !== null) return true;
  } catch {
    // Fall through and try to keep a copy anyway.
  }
  if (readDismissed(store).includes(fingerprint)) return true;

  const record: QuarantineRecord = {
    id,
    sourceKey,
    scope,
    reason,
    detectedAt: (options.now ?? new Date()).toISOString(),
    ...(options.entryCount !== undefined ? { entryCount: options.entryCount } : {}),
    raw,
    persisted: true
  };

  try {
    const { id: _id, persisted: _persisted, ...stored } = record;
    store.setItem(id, JSON.stringify(stored));
  } catch {
    if (!unsavedCopies.has(id)) unsavedCopies.set(id, { ...record, persisted: false });
    return false;
  }
  unsavedCopies.delete(id);

  const siblings = listPersisted(store)
    .filter((candidate) => candidate.sourceKey === sourceKey && candidate.scope === scope)
    .sort(newestFirst);
  for (const stale of siblings.slice(MAX_COPIES_PER_SOURCE)) {
    if (stale.id === id) continue;
    try {
      store.removeItem(stale.id);
    } catch {
      // Best effort; the cap is only a guard against slow growth.
    }
  }
  return true;
}

/**
 * Drops a kept copy without recording a dismissal, for data that this build
 * can read again in place (for example after updating to a newer version).
 */
export function releaseQuarantined(id: string): void {
  unsavedCopies.delete(id);
  try {
    storage()?.removeItem(id);
  } catch {
    // Nothing else to do.
  }
}

/** Releases the copy of `raw` if one exists; used when the same value now reads cleanly. */
export function releaseQuarantinedRaw(sourceKey: string, raw: string, scope: QuarantineScope = "value"): void {
  releaseQuarantined(`${QUARANTINE_PREFIX}${fingerprintRaw(`${sourceKey}#${scope}`, raw)}`);
}

/** Deletes a kept copy at the user's request and stops it being kept again. */
export function deleteQuarantined(id: string): void {
  const store = storage();
  releaseQuarantined(id);
  if (store && id.startsWith(QUARANTINE_PREFIX)) {
    const fingerprint = id.slice(QUARANTINE_PREFIX.length);
    const dismissed = [fingerprint, ...readDismissed(store).filter((item) => item !== fingerprint)];
    try {
      store.setItem(QUARANTINE_DISMISSED_KEY, JSON.stringify(dismissed.slice(0, MAX_DISMISSED)));
    } catch {
      // Worst case the same copy is kept again on a later load.
    }
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(QUARANTINE_CHANGED_EVENT));
}

/** Test helper: forgets copies that only exist in memory. */
export function clearUnsavedQuarantineCopies(): void {
  unsavedCopies.clear();
}

/**
 * Reads and parses a stored JSON value. Returns null when nothing is stored or
 * storage is unavailable; text that is not valid JSON is kept as a copy first.
 */
export function readStoredJson(key: string): { raw: string; value: unknown } | null {
  const store = storage();
  if (!store) return null;
  let raw: string | null;
  try {
    raw = store.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    return { raw, value: JSON.parse(raw) as unknown };
  } catch {
    quarantineRaw(key, raw, "unreadable");
    return null;
  }
}

/** Keeps the entries of a stored list that a reader skipped as a single copy. */
export function quarantineEntries(
  sourceKey: string,
  entries: unknown[],
  currentSchemaVersion: number,
  versionOf: (entry: unknown) => unknown = (entry) => entry
): boolean {
  if (entries.length === 0) return true;
  const reason = entries.every(
    (entry) => reasonForInvalid(versionOf(entry), currentSchemaVersion) === "newer_version"
  )
    ? "newer_version"
    : "invalid";
  return quarantineRaw(sourceKey, JSON.stringify(entries), reason, {
    scope: "entries",
    entryCount: entries.length
  });
}
