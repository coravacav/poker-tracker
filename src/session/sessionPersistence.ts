import type { GuestSession, HostRecovery } from "./types";

export const HOST_RECOVERY_KEY = "poker-tracker:v1:hosted-room";
export const GUEST_SESSION_KEY = "poker-tracker:v1:guest-room";
export const HOST_CONTROLLER_KEY = "poker-tracker:v1:host-controller";

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

export function loadHostRecovery(): HostRecovery | null {
  const value = parseStored<Partial<HostRecovery>>(
    typeof localStorage === "undefined" ? undefined : localStorage,
    HOST_RECOVERY_KEY
  );
  return value?.schemaVersion === 1 &&
    isString(value.publicId) &&
    isString(value.localGameId) &&
    isString(value.hostSecret) &&
    isString(value.inviteSecret) &&
    isString(value.inviteUrl) &&
    isString(value.roomName) &&
    typeof value.lastKnownVersion === "number"
    ? (value as HostRecovery)
    : null;
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

export function getHostControllerId(createId: () => string): string {
  if (typeof sessionStorage === "undefined") return createId();
  const existing = sessionStorage.getItem(HOST_CONTROLLER_KEY);
  if (existing) return existing;
  const created = createId();
  sessionStorage.setItem(HOST_CONTROLLER_KEY, created);
  return created;
}
