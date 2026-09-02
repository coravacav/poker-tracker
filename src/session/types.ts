import type { GameState, Transaction } from "../domain/pokerTypes";
import type { GameAction } from "../state/gameReducer";
import type { Id } from "../../convex/_generated/dataModel";

export type SharedAuditEventKind =
  | "transaction"
  | "cash_out"
  | "correction"
  | "game";

export type SharedAuditEvent = {
  id: string;
  version: number;
  actionType: string;
  kind: SharedAuditEventKind;
  summary: string;
  transactionIds: string[];
  playerIds: string[];
  actorLabel: string;
  createdAt: number;
  notify: boolean;
};

export type SharedNotification = {
  id: string;
  eventId: string;
  title: string;
  summary: string;
  playerIds: string[];
  createdAt: number;
  version: number;
  read: boolean;
};

export type SharedActivity = {
  events: SharedAuditEvent[];
  notifications: SharedNotification[];
  unreadNotificationCount: number;
};

export type RoomStatus = "active" | "ended" | "expired";

export type RoomProjection = {
  publicId: string;
  status: RoomStatus;
  name: string;
  state: GameState;
  version: number;
  endedAt: number | null;
  activity?: SharedActivity;
};

export type HostRoomProjection = RoomProjection & {
  guestCount: number;
  controllerStatus: "active" | "duplicate";
  guestRequests?: GuestTransactionRequest[];
};

export type GuestRoomProjection = RoomProjection & {
  displayName: string;
  guestRequests?: GuestTransactionRequest[];
};

export type GuestTransactionRequest = {
  id: Id<"roomGuestRequests">;
  displayName?: string;
  transaction: Transaction;
  status: "pending" | "approved" | "rejected";
  createdAt: number;
  decidedAt?: number | null;
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
  submitGuestTransaction: (args: {
    publicId: string;
    guestSecret: string;
    transaction: Transaction;
  }) => Promise<string>;
  decideGuestTransaction: (args: {
    publicId: string;
    hostSecret: string;
    controllerId: string;
    requestId: Id<"roomGuestRequests">;
    decision: "approved" | "rejected";
    expectedVersion: number;
  }) => Promise<void>;
  applyAction: (args: {
    publicId: string;
    hostSecret: string;
    controllerId: string;
    expectedVersion: number;
    clientActionId: string;
    action: GameAction;
  }) => Promise<RoomProjection & { duplicate: boolean; resultingVersion: number }>;
  acknowledgeHostNotifications: (args: {
    publicId: string;
    hostSecret: string;
    throughVersion: number;
  }) => Promise<void>;
  acknowledgeGuestNotifications: (args: {
    publicId: string;
    guestSecret: string;
    throughVersion: number;
  }) => Promise<void>;
  claimHost: (publicId: string, hostSecret: string, controllerId: string) => Promise<void>;
  endRoom: (args: {
    publicId: string;
    hostSecret: string;
    controllerId: string;
    expectedVersion: number;
    clientActionId: string;
  }) => Promise<RoomProjection>;
};
