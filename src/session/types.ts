import type { GameState } from "../domain/pokerTypes";
import type { GameAction } from "../state/gameReducer";

export type RoomStatus = "active" | "ended" | "expired";

export type RoomProjection = {
  publicId: string;
  status: RoomStatus;
  name: string;
  state: GameState;
  version: number;
  endedAt: number | null;
};

export type HostRoomProjection = RoomProjection & {
  guestCount: number;
  controllerStatus: "active" | "duplicate";
};

export type GuestRoomProjection = RoomProjection & {
  displayName: string;
};

export type HostRecovery = {
  schemaVersion: 1;
  publicId: string;
  localGameId: string;
  hostSecret: string;
  inviteSecret: string;
  inviteUrl: string;
  roomName: string;
  lastKnownVersion: number;
  endingActionId?: string;
};

export type GuestSession = {
  schemaVersion: 1;
  publicId: string;
  guestSecret: string;
  presenceSessionId: string;
  displayName: string;
};

export type RoomTransport = {
  configured: boolean;
  connectionState: () => boolean;
  subscribeToConnection: (listener: (connected: boolean) => void) => () => void;
  createRoom: (args: {
    publicId: string;
    localGameId: string;
    snapshot: GameState;
    hostSecret: string;
    inviteSecret: string;
    controllerId: string;
  }) => Promise<RoomProjection>;
  getInvitePreview: (
    publicId: string,
    inviteSecret: string
  ) => Promise<{ status: RoomStatus | "invalid"; name?: string }>;
  joinRoom: (args: {
    publicId: string;
    inviteSecret: string;
    guestSecret: string;
    displayName: string;
  }) => Promise<GuestRoomProjection>;
  subscribeHost: (
    args: { publicId: string; hostSecret: string; controllerId: string },
    onUpdate: (room: HostRoomProjection) => void,
    onError: (error: Error) => void
  ) => () => void;
  subscribeGuest: (
    args: { publicId: string; guestSecret: string },
    onUpdate: (room: GuestRoomProjection) => void,
    onError: (error: Error) => void
  ) => () => void;
  heartbeat: (publicId: string, guestSecret: string, sessionId: string) => Promise<void>;
  applyAction: (args: {
    publicId: string;
    hostSecret: string;
    controllerId: string;
    expectedVersion: number;
    clientActionId: string;
    action: GameAction;
  }) => Promise<RoomProjection & { duplicate: boolean; resultingVersion: number }>;
  claimHost: (publicId: string, hostSecret: string, controllerId: string) => Promise<void>;
  endRoom: (args: {
    publicId: string;
    hostSecret: string;
    controllerId: string;
    expectedVersion: number;
    clientActionId: string;
  }) => Promise<RoomProjection>;
};
