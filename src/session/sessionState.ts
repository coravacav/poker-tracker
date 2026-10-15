import type { GameState } from "../domain/pokerTypes";
import { validatePersistedState } from "../domain/validation";
import { migratePersistedState } from "../state/persistence";
import { createCapability, parseInviteRoute, type InviteRoute } from "./capabilities";
import {
  loadGuestSession,
  loadHostRecovery,
  recoverGuestSession,
  saveHostRecovery
} from "./sessionPersistence";
import type {
  GuestRoomProjection,
  GuestSession,
  HostRecovery,
  HostRoomProjection
} from "./types";

export type InviteState = {
  mode: "joining";
  route: Extract<InviteRoute, { kind: "invite" }>;
  preview: { status: "loading" | "active" | "invalid" | "ended" | "closed"; name?: string };
  error: string | null;
  joining: boolean;
};

export type GuestState = {
  mode: "guest";
  credentials: GuestSession;
  room: GuestRoomProjection | null;
  connected: boolean;
  error: string | null;
};

export type HostState = {
  mode: "hosting" | "creating_room" | "ending" | "recovery_required" | "room_unavailable";
  recovery: HostRecovery | null;
  room: HostRoomProjection | null;
  connected: boolean;
  roomReady: boolean;
  pending: boolean;
  error: string | null;
};

export type LocalState = { mode: "local"; notice: string | null };
export type InvalidState = { mode: "invalid_invite"; message: string };
export type SessionState = LocalState | InviteState | GuestState | HostState | InvalidState;
export type LocalEntryDestination = "play" | "setup";

const ROOM_UNAVAILABLE_COPY =
  "The shared room is unavailable. Your latest accepted game is safe on this device.";
export const DEPLOYMENT_MISMATCH_COPY =
  "This shared room belongs to a different deployment. Your local copy is safe on this device.";

export function normalizeRoomState(value: unknown): GameState | null {
  if (
    !validatePersistedState(value) ||
    (value.schemaVersion !== 6 && value.schemaVersion !== 7 && value.schemaVersion !== 8)
  ) {
    return null;
  }

  return migratePersistedState(value);
}

export function updateHostRecovery(
  recovery: HostRecovery,
  room: HostRoomProjection,
  deploymentUrl: string | null
): HostRecovery {
  const next: HostRecovery = {
    ...recovery,
    roomName: room.name,
    lastKnownVersion: room.version,
    ...(deploymentUrl ? { deploymentUrl } : {})
  };
  saveHostRecovery(next);
  return next;
}

export function initialSession(localGameId: string, deploymentUrl: string | null): SessionState {
  const route = parseInviteRoute();
  if (route.kind === "invite") {
    return {
      mode: "joining",
      route,
      preview: { status: "loading" },
      error: null,
      joining: false
    };
  }
  if (route.kind === "guest_room") {
    const credentials =
      loadGuestSession(route.publicId) ??
      recoverGuestSession(route.publicId, createCapability(18), deploymentUrl);
    return credentials
      ? { mode: "guest", credentials, room: null, connected: false, error: null }
      : {
          mode: "invalid_invite",
          message: "This guest session is not available in this browser tab. Open the original invite again."
        };
  }
  const recovery = loadHostRecovery();
  if (recovery?.localGameId === localGameId) {
    const deploymentMismatch =
      recovery.deploymentUrl !== undefined &&
      deploymentUrl !== null &&
      recovery.deploymentUrl !== deploymentUrl;
    return {
      mode: deploymentMismatch ? "room_unavailable" : "hosting",
      recovery,
      room: null,
      connected: false,
      roomReady: false,
      pending: false,
      error: deploymentMismatch ? DEPLOYMENT_MISMATCH_COPY : null
    };
  }
  return { mode: "local", notice: null };
}
