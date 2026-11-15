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

export type FriendRoom = {
  publicId: string;
  name: string;
  createdAt: number;
};

export type FriendActivity = {
  friendCode: string;
  displayName: string;
  /** Newest discoverable room. */
  room: FriendRoom | null;
  /** Every discoverable room (bounded server-side); absent from older backends. */
  rooms?: FriendRoom[];
};

export type HostRoomProjection = RoomProjection & {
  guestCount: number;
  controllerStatus: "active" | "duplicate";
  guestRequests?: GuestTransactionRequest[];
  joiningOpen?: boolean;
  guests?: HostGuestSession[];
  visibleToFriends?: boolean;
  friendProfileLinked?: boolean;
  /** Whether the read-only watch link is on; absent from older backends. */
  watchLinkOn?: boolean;
  /** Short id of the current watch link (null while off), to tell whether a stored secret is still current. */
  watchLinkId?: string | null;
  /** Watchers online through the watch link. */
  watcherCount?: number;
  /** The host's own seat ("This is me"), or null while unset; absent from older backends. */
  hostPlayerId?: string | null;
  /** The host said they aren't playing, so the dialog stops asking for their seat. */
  hostNotPlaying?: boolean;
  /** Every active seat in seat order, with the phone holding it. */
  seats?: HostSeat[];
  /** "Players confirm each other" is on; absent from older backends. */
  peerConfirm?: boolean;
  /** Agreements the host answers or settles; absent from older backends. */
  needsHost?: HostAgreementNeeds;
};

export type AgreementKind = "give" | "buy" | "bank";
export type AgreementStatus = "open" | "bounced" | "cancelled" | "expired" | "dismissed" | "recorded";
export type AgreementClosedReason =
  | "proposer"
  | "seat_lost"
  /** The other player's (or named witness's) seat lost its phone or changed. */
  | "counterparty_seat_lost"
  | "revoked"
  | "ended"
  | "peer_confirm_off"
  | "invalid";

/**
 * An entry one seated player proposed and another confirms. give: the
 * proposer gave the other player chips; buy: the proposer bought chips from
 * them; bank: the proposer bought in from the bank, seen by another player.
 */
export type RoomAgreement = {
  id: Id<"roomAgreements">;
  kind: AgreementKind;
  amountCents: number;
  note: string | null;
  proposerPlayerId: string;
  proposerName: string;
  counterpartyPlayerId: string | null;
  counterpartyName: string | null;
  /** bank only: the one player asked to see it, if the proposer named one. */
  witnessPlayerId: string | null;
  witnessName: string | null;
  /** give/buy: the host answers, as the other seat had no phone when it was sent. */
  hostAnswers?: boolean;
  status: AgreementStatus;
  closedReason: AgreementClosedReason | null;
  bounceReason: string | null;
  /** Turned back by the host rather than a player. */
  bouncedByHost: boolean;
  createdAt: number;
  /** Open entries stop being answerable at this time. */
  expiresAt: number;
  decidedAt: number | null;
  confirmedByPlayerId: string | null;
  confirmedByName: string | null;
  confirmedVia: "peer" | "host" | null;
  transactionId: string | null;
  /** The recorded entry was voided by the host since. */
  voided: boolean;
};

/** A guest's Inbox buckets. */
export type GuestAgreements = {
  needsMe: RoomAgreement[];
  mine: RoomAgreement[];
  bounced: RoomAgreement[];
  recentDone: RoomAgreement[];
};

export type HostAgreementNeeds = {
  /** "self": the host's own seat; "seat": a seat with no phone when it was sent; "bank": any bank buy-in. */
  answer: (RoomAgreement & { answerAs: "self" | "seat" | "bank" })[];
  /** Bounced by a player: Dismiss or Record anyway. */
  bounced: RoomAgreement[];
};

export type AgreementResult = { status: AgreementStatus; reason: AgreementClosedReason | null };

export type AgreementProposal = {
  kind: AgreementKind;
  amountCents: number;
  /** give/buy: the other player's seat. */
  counterpartyPlayerId?: string;
  /** bank: optionally, the one player asked to see it. */
  witnessPlayerId?: string;
  note?: string;
};

/** A seat someone with the invitation can pick; `claimed` means another phone holds it. */
export type SeatOption = {
  playerId: string;
  name: string;
  claimed: boolean;
  isHost: boolean;
  /** The host released this seat; only the host can put a phone there. */
  releasedByHost?: boolean;
};

export type InvitePreview = { status: RoomStatus | "invalid" | "closed"; name?: string; seats?: SeatOption[] };

export type HostSeat = {
  playerId: string;
  name: string;
  isHost: boolean;
  guest: { id: Id<"roomGuests">; displayName: string; connected: boolean } | null;
  /** The host released it and no phone holds it, so only the host can fill it. */
  releasedByHost?: boolean;
};

/** What the watch link shows: the sanitized table and the latest events, newest first. */
export type SpectatorRoomProjection = RoomProjection & {
  events: SharedAuditEvent[];
};

export type HostGuestSession = {
  id: Id<"roomGuests">;
  displayName: string;
  joinedAt: number;
  connected: boolean;
  revoked: boolean;
};

export type GuestRoomProjection = RoomProjection & {
  displayName: string;
  hostProfile?: { friendCode: string; displayName: string } | null;
  /** The seat this guest holds, or null; absent from older backends. */
  seatPlayerId?: string | null;
  /** Why the guest last lost a seat: the host released it, or its player changed. */
  seatLost?: "released" | "changed" | null;
  seats?: SeatOption[];
  guestRequests?: GuestTransactionRequest[];
  /** "Players confirm each other" is on; absent from older backends. */
  peerConfirm?: boolean;
  agreements?: GuestAgreements;
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
  deploymentUrl?: string;
  endingActionId?: string;
  /** The watch link's secret while it is on, so the link survives reloads. */
  spectatorSecret?: string;
};

export type GuestSession = {
  schemaVersion: 1;
  publicId: string;
  guestSecret: string;
  presenceSessionId: string;
  displayName: string;
};

export type RoomHistoryCredential = {
  schemaVersion: 1;
  publicId: string;
  role: "host" | "guest";
  secret: string;
  roomName: string;
  joinedAt: number;
  displayName?: string;
  deploymentUrl?: string;
};

export type RoomHistoryProjection = RoomProjection & {
  role: "host" | "guest";
  createdAt: number;
  displayName: string | null;
  /** Host rooms only: the watch link still works. */
  watchLinkOn?: boolean;
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
    friendCode?: string;
    profileOwnerSecret?: string;
    visibleToFriends?: boolean;
    peerConfirm?: boolean;
  }) => Promise<RoomProjection>;
  getInvitePreview: (
    publicId: string,
    inviteSecret: string
  ) => Promise<InvitePreview>;
  /** The invitation preview, kept live while someone is on the join screen. */
  subscribeInvitePreview?: (
    args: { publicId: string; inviteSecret: string },
    onUpdate: (preview: InvitePreview) => void,
    onError: (error: Error) => void
  ) => () => void;
  /** Joins with a seat (taking its player's name) or with a display name. */
  joinRoom: (args: {
    publicId: string;
    inviteSecret: string;
    guestSecret: string;
    displayName?: string;
    playerId?: string;
  }) => Promise<GuestRoomProjection>;
  /** The host's own phone joins with the host's one-time phone link, in the host's seat. */
  joinHostPhone?: (args: {
    publicId: string;
    linkSecret: string;
    guestSecret: string;
  }) => Promise<GuestRoomProjection>;
  /** Host: makes a one-time link that seats the host's own phone in the host's seat. */
  createHostPhoneLink?: (args: {
    publicId: string;
    hostSecret: string;
    linkSecret: string;
  }) => Promise<{ expiresAt: number }>;
  /** Host: voids an unused phone link. */
  cancelHostPhoneLink?: (args: { publicId: string; hostSecret: string }) => Promise<void>;
  /** A guest takes an open seat, moving off any seat they held. */
  claimSeat?: (args: { publicId: string; guestSecret: string; playerId: string }) => Promise<void>;
  /** Host: frees a guest's seat; `playerId` is the seat the host saw them in. */
  releaseSeat?: (args: {
    publicId: string;
    hostSecret: string;
    guestId: Id<"roomGuests">;
    playerId: string;
  }) => Promise<void>;
  assignSeat?: (args: {
    publicId: string;
    hostSecret: string;
    guestId: Id<"roomGuests">;
    playerId: string;
  }) => Promise<void>;
  setHostPlayer?: (args: { publicId: string; hostSecret: string; playerId: string | null }) => Promise<void>;
  joinFriendRoom?: (args: {
    publicId: string;
    friendCode: string;
    guestSecret: string;
    displayName: string;
  }) => Promise<GuestRoomProjection>;
  createFriendProfile?: (args: {
    friendCode: string;
    displayName: string;
    ownerSecret: string;
  }) => Promise<{ friendCode: string; displayName: string }>;
  lookupFriendProfile?: (
    friendCode: string
  ) => Promise<{ friendCode: string; displayName: string } | null>;
  updateFriendProfileName?: (args: {
    friendCode: string;
    ownerSecret: string;
    displayName: string;
  }) => Promise<{ friendCode: string; displayName: string }>;
  rotateFriendCode?: (args: {
    friendCode: string;
    ownerSecret: string;
    newFriendCode: string;
  }) => Promise<{ friendCode: string; displayName: string }>;
  subscribeFriendActivity?: (
    friendCodes: string[],
    onUpdate: (activity: FriendActivity[]) => void,
    onError: (error: Error) => void
  ) => () => void;
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
  subscribeSpectator?: (
    args: { publicId: string; spectatorSecret: string },
    onUpdate: (room: SpectatorRoomProjection) => void,
    onError: (error: Error) => void
  ) => () => void;
  spectatorHeartbeat?: (args: {
    publicId: string;
    spectatorSecret: string;
    sessionId: string;
  }) => Promise<void>;
  /** Turns the watch link on or replaces it (a new secret), or off (null). */
  rotateSpectatorLink?: (args: {
    publicId: string;
    hostSecret: string;
    spectatorSecret: string | null;
  }) => Promise<void>;
  proposeAgreement?: (args: AgreementProposal & {
    publicId: string;
    guestSecret: string;
    clientRequestId: string;
  }) => Promise<Id<"roomAgreements">>;
  /** Confirm / I saw it ("confirm"), or Not right / I didn't see it ("not_right"). */
  answerAgreement?: (args: {
    publicId: string;
    guestSecret: string;
    agreementId: Id<"roomAgreements">;
    answer: "confirm" | "not_right";
    reason?: string;
  }) => Promise<AgreementResult>;
  cancelAgreement?: (args: {
    publicId: string;
    guestSecret: string;
    agreementId: Id<"roomAgreements">;
  }) => Promise<AgreementResult>;
  dismissAgreement?: (args: {
    publicId: string;
    guestSecret: string;
    agreementId: Id<"roomAgreements">;
  }) => Promise<AgreementResult>;
  setPeerConfirm?: (args: {
    publicId: string;
    hostSecret: string;
    controllerId: string;
    on: boolean;
  }) => Promise<void>;
  hostAnswerAgreement?: (args: {
    publicId: string;
    hostSecret: string;
    controllerId: string;
    agreementId: Id<"roomAgreements">;
    answer: "confirm" | "not_right";
  }) => Promise<AgreementResult>;
  hostResolveBounced?: (args: {
    publicId: string;
    hostSecret: string;
    controllerId: string;
    agreementId: Id<"roomAgreements">;
    decision: "dismiss" | "record";
  }) => Promise<AgreementResult>;
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
  setJoiningOpen: (args: {
    publicId: string;
    hostSecret: string;
    open: boolean;
  }) => Promise<void>;
  setFriendVisibility?: (args: {
    publicId: string;
    hostSecret: string;
    visible: boolean;
  }) => Promise<void>;
  rotateInvite: (args: {
    publicId: string;
    hostSecret: string;
    inviteSecret: string;
  }) => Promise<void>;
  revokeGuest: (args: {
    publicId: string;
    hostSecret: string;
    guestId: Id<"roomGuests">;
  }) => Promise<void>;
  getRoomHistory: (
    credentials: RoomHistoryCredential[]
  ) => Promise<RoomHistoryProjection[]>;
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
