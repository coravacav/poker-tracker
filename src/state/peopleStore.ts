/**
 * Storage for the device-local people directory (domain/people.ts). It is
 * small, so it lives in one localStorage key and is read synchronously, which
 * lets name entry link players without waiting. Data this build cannot read is
 * kept aside first (storageQuarantine) and, if no copy could be kept, the
 * directory is not written for the rest of the session.
 */
import {
  EMPTY_PEOPLE_DIRECTORY,
  PEOPLE_SCHEMA_VERSION,
  linkGamePlayers,
  mergePeopleDirectories,
  parsePeopleDirectory,
  type PeopleDirectory
} from "../domain/people";
import type { GameState } from "../domain/pokerTypes";
import { createId } from "./seedGame";
import {
  QUARANTINE_CHANGED_EVENT,
  quarantineEntries,
  quarantineRaw,
  reasonForInvalid,
  releaseQuarantinedRaw
} from "./storageQuarantine";

export const PEOPLE_KEY = "poker-tracker:v1:people";
export const PEOPLE_CHANGED_EVENT = "poker-tracker:people-changed";

type Loaded = { raw: string | null; directory: PeopleDirectory; writable: boolean };
let cache: Loaded | null = null;
let listening = false;

function storage(): Storage | undefined {
  return typeof localStorage === "undefined" ? undefined : localStorage;
}

function announceQuarantine(): void {
  // Deferred: loads can happen while React renders another component.
  if (typeof window !== "undefined") queueMicrotask(() => window.dispatchEvent(new Event(QUARANTINE_CHANGED_EVENT)));
}

function read(): Loaded {
  const store = storage();
  if (!store) return { raw: null, directory: EMPTY_PEOPLE_DIRECTORY, writable: false };
  let raw: string | null;
  try {
    raw = store.getItem(PEOPLE_KEY);
  } catch {
    return { raw: null, directory: EMPTY_PEOPLE_DIRECTORY, writable: false };
  }
  if (!raw) return { raw, directory: EMPTY_PEOPLE_DIRECTORY, writable: true };

  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    const kept = quarantineRaw(PEOPLE_KEY, raw, "unreadable");
    announceQuarantine();
    return { raw, directory: EMPTY_PEOPLE_DIRECTORY, writable: kept };
  }
  const parsed = parsePeopleDirectory(value);
  if (!parsed) {
    const kept = quarantineRaw(PEOPLE_KEY, raw, reasonForInvalid(value, PEOPLE_SCHEMA_VERSION));
    announceQuarantine();
    return { raw, directory: EMPTY_PEOPLE_DIRECTORY, writable: kept };
  }
  if (parsed.skipped.length > 0) {
    const kept = quarantineEntries(PEOPLE_KEY, parsed.skipped, PEOPLE_SCHEMA_VERSION);
    announceQuarantine();
    return { raw, directory: parsed.directory, writable: kept };
  }
  releaseQuarantinedRaw(PEOPLE_KEY, raw);
  return { raw, directory: parsed.directory, writable: true };
}

function listen(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("storage", (event) => {
    if (event.key !== PEOPLE_KEY && event.key !== null) return;
    cache = null;
    window.dispatchEvent(new Event(PEOPLE_CHANGED_EVENT));
  });
}

function load(): Loaded {
  listen();
  cache ??= read();
  return cache;
}

/** The current directory; the same object until it changes, so it is safe as a React snapshot. */
export function loadPeopleDirectory(): PeopleDirectory {
  return load().directory;
}

/** Whether changes can be saved (false when unreadable data could not be kept aside). */
export function canSavePeopleDirectory(): boolean {
  return load().writable;
}

function save(directory: PeopleDirectory): boolean {
  const store = storage();
  if (!store || !load().writable) return false;
  const raw = JSON.stringify(directory);
  try {
    store.setItem(PEOPLE_KEY, raw);
  } catch {
    return false;
  }
  cache = { raw, directory, writable: true };
  if (typeof window !== "undefined") window.dispatchEvent(new Event(PEOPLE_CHANGED_EVENT));
  return true;
}

/**
 * Applies a change to the latest stored directory and saves it. Returns the
 * saved directory, or null when the change was rejected or could not be saved.
 */
export function updatePeopleDirectory(
  change: (directory: PeopleDirectory) => PeopleDirectory | null
): PeopleDirectory | null {
  cache = null;
  const current = loadPeopleDirectory();
  const next = change(current);
  if (!next) return null;
  if (next === current) return current;
  return save(next) ? next : null;
}

/** Restores people from a backup, merging with this device's directory. */
export function mergeStoredPeople(incoming: PeopleDirectory): boolean {
  if (incoming.people.length === 0) return true;
  return updatePeopleDirectory((current) => mergePeopleDirectories(current, incoming)) !== null;
}

/**
 * Links a finished game's players to people (creating people for new names)
 * before it is archived. When the directory cannot be saved, only links to
 * people that already exist are added.
 */
export function linkGameToPeople(state: GameState, now = new Date()): GameState {
  let linkedState = state;
  const saved = updatePeopleDirectory((directory) => {
    const linked = linkGamePlayers(state, directory, now.toISOString(), () => createId("person"));
    linkedState = linked.state;
    return linked.directory;
  });
  if (saved) return linkedState;
  return linkGamePlayers(state, loadPeopleDirectory(), now.toISOString(), null).state;
}

/** Test helper: forgets the cached directory. */
export function resetPeopleStoreForTests(): void {
  cache = null;
}
