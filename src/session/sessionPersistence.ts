import type { GuestSession, HostRecovery, RoomHistoryCredential } from "./types";
import {
  quarantineEntries,
  quarantineRaw,
  readStoredJson,
  reasonForInvalid
} from "../state/storageQuarantine";

export const HOST_RECOVERY_KEY = "poker-tracker:v1:hosted-room";
export const GUEST_SESSION_KEY = "poker-tracker:v1:guest-room";
export const HOST_CONTROLLER_KEY = "poker-tracker:v1:host-controller";
export const ROOM_HISTORY_KEY = "poker-tracker:v1:room-history";

function parseStored<T>(storage: Storage | undefined, key: string): T | null {
  if (!storage) return null;
  try {
    const value = storage.getItem(key);
    return value ? (JSON.parse(value) as T) : null;
  } catch {
    return null;
  }
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

const SESSION_SCHEMA_VERSION = 1;

export function loadHostRecovery(): HostRecovery | null {
  const stored = readStoredJson(HOST_RECOVERY_KEY);
  if (!stored) return null;
  const value = (stored.value && typeof stored.value === "object" ? stored.value : {}) as Partial<HostRecovery>;
  const valid = value.schemaVersion === 1 &&
    isString(value.publicId) &&
    isString(value.localGameId) &&
    isString(value.hostSecret) &&
    isString(value.inviteSecret) &&
    isString(value.inviteUrl) &&
    isString(value.roomName) &&
    typeof value.lastKnownVersion === "number" &&
    (value.deploymentUrl === undefined || isString(value.deploymentUrl));
  if (valid) return value as HostRecovery;
  // The host secret cannot be recreated, so keep a copy before a new room replaces it.
  quarantineRaw(HOST_RECOVERY_KEY, stored.raw, reasonForInvalid(stored.value, SESSION_SCHEMA_VERSION));
  return null;
}

export function saveHostRecovery(value: HostRecovery): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    localStorage.setItem(HOST_RECOVERY_KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function clearHostRecovery(): void {
  if (typeof localStorage !== "undefined") localStorage.removeItem(HOST_RECOVERY_KEY);
}

export function loadGuestSession(publicId?: string): GuestSession | null {
  const value = parseStored<Partial<GuestSession>>(
    typeof sessionStorage === "undefined" ? undefined : sessionStorage,
    GUEST_SESSION_KEY
  );
  return value?.schemaVersion === 1 &&
    isString(value.publicId) &&
    isString(value.guestSecret) &&
    isString(value.presenceSessionId) &&
    isString(value.displayName) &&
    (!publicId || value.publicId === publicId)
    ? (value as GuestSession)
    : null;
}

export function saveGuestSession(value: GuestSession): void {
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.setItem(GUEST_SESSION_KEY, JSON.stringify(value));
  }
}

export function clearGuestSession(): void {
  if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(GUEST_SESSION_KEY);
}

export function recoverGuestSession(
  publicId: string,
  presenceSessionId: string,
  deploymentUrl: string | null
): GuestSession | null {
  const credential = loadRoomHistoryCredentials().find(
    (candidate) =>
      candidate.role === "guest" &&
      candidate.publicId === publicId &&
      isString(candidate.displayName) &&
      (candidate.deploymentUrl === undefined ||
        deploymentUrl === null ||
        candidate.deploymentUrl === deploymentUrl)
  );
  if (!credential?.displayName) return null;

  const session: GuestSession = {
    schemaVersion: 1,
    publicId: credential.publicId,
    guestSecret: credential.secret,
    presenceSessionId,
    displayName: credential.displayName
  };
  saveGuestSession(session);
  return session;
}

export function loadRoomHistoryCredentials(): RoomHistoryCredential[] {
  const stored = readStoredJson(ROOM_HISTORY_KEY);
  if (!stored) return [];
  const values = stored.value;
  if (!Array.isArray(values)) {
    quarantineRaw(ROOM_HISTORY_KEY, stored.raw, "invalid");
    return [];
  }
  const skipped: unknown[] = [];
  const credentials = values.filter((value): value is RoomHistoryCredential => {
    const candidate = (value && typeof value === "object" ? value : {}) as Partial<RoomHistoryCredential>;
    const valid = candidate.schemaVersion === 1 &&
      isString(candidate.publicId) &&
      (candidate.role === "host" || candidate.role === "guest") &&
      isString(candidate.secret) &&
      isString(candidate.roomName) &&
      typeof candidate.joinedAt === "number" &&
      (candidate.deploymentUrl === undefined || isString(candidate.deploymentUrl));
    if (!valid) skipped.push(value);
    return valid;
  }).slice(0, 50);
  quarantineEntries(ROOM_HISTORY_KEY, skipped, SESSION_SCHEMA_VERSION);
  return credentials;
}

export function saveRoomHistoryCredential(value: RoomHistoryCredential): void {
  if (typeof localStorage === "undefined") return;
  const existing = loadRoomHistoryCredentials().filter(
    (credential) => !(credential.publicId === value.publicId && credential.role === value.role)
  );
  try {
    localStorage.setItem(ROOM_HISTORY_KEY, JSON.stringify([value, ...existing].slice(0, 50)));
  } catch {
    // The active session still works when optional history storage is unavailable.
  }
}

export function getHostControllerId(createId: () => string): string {
  if (typeof sessionStorage === "undefined") return createId();
  const existing = sessionStorage.getItem(HOST_CONTROLLER_KEY);
  if (existing) return existing;
  const created = createId();
  sessionStorage.setItem(HOST_CONTROLLER_KEY, created);
  return created;
}
