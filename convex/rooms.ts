import { Presence } from "@convex-dev/presence";
import { ConvexError, v } from "convex/values";
import type { GameState, Transaction } from "../src/domain/pokerTypes";
import {
  applyHostedAction,
  MAX_ROOM_ACTIONS,
  MAX_ROOM_GUESTS,
  normalizeGameState,
  roomStateError,
  sanitizeGuestState
} from "../src/session/roomProtocol";
import { components } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";

const presence = new Presence(components.presence);

const HOST_RECIPIENT_KEY = "host";
const MAX_SHARED_AUDIT_EVENTS = 500;
const MAX_PUBLIC_SHARED_AUDIT_EVENTS = 200;

type RoomErrorCode =
  | "INVALID_ARGUMENT"
  | "INVALID_CAPABILITY"
  | "ROOM_NOT_FOUND"
  | "ROOM_NOT_ACTIVE"
  | "ROOM_ENDED"
  | "VERSION_CONFLICT"
  | "DUPLICATE_CONTROLLER"
  | "ROOM_LIMIT_REACHED";

type AuditEventKind = "transaction" | "cash_out" | "correction" | "game";

type AuditEventDraft = {
  eventId: string;
  version: number;
  actionType: string;
  kind: AuditEventKind;
  summary: string;
  transactionIds: string[];
  playerIds: string[];
  actorLabel: string;
  createdAt: number;
  notify: boolean;
};

function isPrivateAuditAction(type: string): boolean {
  return [
    "save_cash_out_draft",
    "clear_cash_out_draft",
    "start_cash_out_correction"
  ].includes(type);
}

function fail(code: RoomErrorCode, message: string): never {
  throw new ConvexError({ code, message });
}

function validIdentifier(value: string): boolean {
  return /^[A-Za-z0-9_-]{16,160}$/.test(value);
}

function validSecret(value: string): boolean {
  return /^[A-Za-z0-9_-]{32,256}$/.test(value);
}

async function hashSecret(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret)
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function sameHash(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function formatAmount(amountCents: number): string {
  return `$${(amountCents / 100).toFixed(2)}`;
}

function playerName(state: GameState, playerId: string | undefined): string {
  if (!playerId) return "Chip Pool";
  return state.players.find((player) => player.id === playerId)?.name ?? "Unknown player";
}

function transactionPlayerIds(transaction: Transaction): string[] {
  return [
    transaction.fromPlayerId,
    transaction.toPlayerId,
    transaction.coveredByPlayerId,
    transaction.coveredPlayerId
  ].filter((playerId): playerId is string => typeof playerId === "string");
}

function describeTransaction(transaction: Transaction, state: GameState): string {
  const amount = formatAmount(transaction.amountCents);

  if (transaction.type === "bank_buy_in") {
    const recipient = playerName(state, transaction.toPlayerId);
    if (transaction.coveredByPlayerId) {
      return `${playerName(state, transaction.coveredByPlayerId)} covered ${recipient}'s buy-in of ${amount}`;
    }
    return `${recipient} bought in for ${amount}`;
  }

  if (transaction.type === "bank_cash_out") {
    const verb = transaction.cashOutKind === "final" ? "cashed out" : "partially cashed out";
    return `${playerName(state, transaction.fromPlayerId)} ${verb} ${amount}`;
  }

  if (transaction.type === "player_gave" || transaction.type === "player_transfer") {
    return `${playerName(state, transaction.fromPlayerId)} gave ${playerName(state, transaction.toPlayerId)} ${amount}`;
  }

  if (transaction.type === "player_owes") {
    return `${playerName(state, transaction.fromPlayerId)} owes ${playerName(state, transaction.toPlayerId)} ${amount}`;
  }

  if (transaction.type === "debt_coverage") {
    return `${playerName(state, transaction.coveredByPlayerId)} covered ${playerName(state, transaction.coveredPlayerId)}'s debt of ${amount}`;
  }

  return `Chip pool ${transaction.bankDirection === "outgoing" ? "decreased" : "increased"} by ${amount}`;
}

function changedTransactions(before: GameState, after: GameState): Transaction[] {
  const beforeById = new Map(before.transactions.map((transaction) => [transaction.id, transaction]));
  const afterById = new Map(after.transactions.map((transaction) => [transaction.id, transaction]));
  const ids = new Set([...beforeById.keys(), ...afterById.keys()]);

  return [...ids]
    .filter((id) => JSON.stringify(beforeById.get(id)) !== JSON.stringify(afterById.get(id)))
    .map((id) => afterById.get(id) ?? beforeById.get(id))
    .filter((transaction): transaction is Transaction => transaction !== undefined);
}

function actionType(action: unknown): string {
  if (!action || typeof action !== "object" || typeof (action as { type?: unknown }).type !== "string") {
    return "unknown";
  }
  return (action as { type: string }).type;
}

function actionPlayerIds(action: unknown): string[] {
  if (!action || typeof action !== "object") return [];
  const candidate = action as Record<string, unknown>;
  return [
    candidate.playerId,
    candidate.fromPlayerId,
    candidate.toPlayerId,
    candidate.coveredPlayerId,
    candidate.coveredByPlayerId
  ].filter((playerId): playerId is string => typeof playerId === "string");
}

function auditSummary(
  action: unknown,
  before: GameState,
  after: GameState,
  changed: Transaction[]
): string {
  const type = actionType(action);
  const added = changed.filter(
    (transaction) => !before.transactions.some((candidate) => candidate.id === transaction.id)
  );
  const firstAdded = added[0];

  if (type === "add_transaction" && firstAdded) return describeTransaction(firstAdded, after);
  if (type === "add_transactions") {
    return added.length === 1
      ? describeTransaction(firstAdded!, after)
      : `Added ${added.length} transactions`;
  }
  if (type === "record_cash_out" && firstAdded) return describeTransaction(firstAdded, after);
  if (type === "replace_cash_out" && firstAdded) {
    return `Corrected ${describeTransaction(firstAdded, after)}`;
  }
  if (type === "flip_transaction" && firstAdded) {
    return `Reversed ${describeTransaction(firstAdded, after)}`;
  }
  if (type === "void_transaction" && changed[0]) {
    return `Voided ${describeTransaction(changed[0], after)}`;
  }
  if (type === "undo_recent_transaction" && changed[0]) {
    return `Undid ${describeTransaction(changed[0], before)}`;
  }

  const candidate = action && typeof action === "object" ? action as Record<string, unknown> : {};
  const firstPlayerId = typeof candidate.playerId === "string" ? candidate.playerId : undefined;
  const firstPlayer = playerName(after, firstPlayerId);

  switch (type) {
    case "set_game_name":
      return `Renamed the game to ${typeof candidate.name === "string" ? candidate.name.trim() || "Poker Night" : "Poker Night"}`;
    case "set_default_buy_in":
      return `Changed the default buy-in to ${formatAmount(typeof candidate.amountCents === "number" ? candidate.amountCents : 0)}`;
    case "set_chip_denominations":
      return "Updated the chip value key";
    case "set_table_shape":
      return `Changed the table shape to ${typeof candidate.shape === "string" ? candidate.shape : "custom"}`;
    case "move_table_seat":
      return "Updated the table layout";
    case "move_player_to_seat":
      return `${firstPlayer} moved to a different seat`;
    case "set_player_count":
      return `Changed the player count to ${typeof candidate.count === "number" ? candidate.count : "a new value"}`;
    case "add_player":
      return `Added ${firstPlayer}`;
    case "replace_active_players":
      return `Updated the player list (${after.players.filter((player) => player.isActive).length} active)`;
    case "rename_player":
      return `Renamed ${firstPlayer}`;
    case "archive_player":
      return `Archived ${firstPlayer}`;
    case "reorder_players":
      return "Reordered the players";
    case "save_cash_out_draft":
      return `Updated the cash-out draft for ${firstPlayer}`;
    case "clear_cash_out_draft":
      return `Cleared the cash-out draft for ${firstPlayer}`;
    case "start_cash_out_correction":
      return `Started a cash-out correction for ${firstPlayer}`;
    default:
      return `Updated the shared game (${type})`;
  }
}

function auditKind(type: string, changed: Transaction[]): AuditEventKind {
  if (["flip_transaction", "void_transaction", "undo_recent_transaction"].includes(type)) {
    return "correction";
  }
  if (["record_cash_out", "replace_cash_out", "save_cash_out_draft", "clear_cash_out_draft", "start_cash_out_correction"].includes(type)) {
    return "cash_out";
  }
  if (changed.length > 0 || ["add_transaction", "add_transactions"].includes(type)) {
    return "transaction";
  }
  return "game";
}

function buildAuditEvent(
  before: GameState,
  after: GameState,
  action: unknown,
  version: number,
  createdAt: number
): AuditEventDraft | null {
  const type = actionType(action);
  if (isPrivateAuditAction(type)) return null;
  const changed = changedTransactions(before, after);
  const kind = auditKind(type, changed);
  const transactionIds = changed.map((transaction) => transaction.id);
  const playerIds = [
    ...actionPlayerIds(action),
    ...changed.flatMap(transactionPlayerIds)
  ].filter((playerId, index, all) => all.indexOf(playerId) === index);

  return {
    eventId: `event_${crypto.randomUUID()}`,
    version,
    actionType: type,
    kind,
    summary: auditSummary(action, before, after, changed),
    transactionIds,
    playerIds,
    actorLabel: "Host",
    createdAt,
    notify: kind !== "game"
  };
}

async function appendAuditEvent(ctx: MutationCtx, roomId: Doc<"rooms">["_id"], event: AuditEventDraft) {
  await ctx.db.insert("roomAuditEvents", { roomId, ...event });
  const retained = await ctx.db
    .query("roomAuditEvents")
    .withIndex("by_room_id_and_created_at", (index) => index.eq("roomId", roomId))
    .order("desc")
    .take(MAX_SHARED_AUDIT_EVENTS + 1);
  for (const staleEvent of retained.slice(MAX_SHARED_AUDIT_EVENTS)) {
    await ctx.db.delete(staleEvent._id);
  }
}

function notificationTitle(kind: AuditEventKind): string {
  if (kind === "transaction") return "Transaction recorded";
  if (kind === "cash_out") return "Cash-out updated";
  if (kind === "correction") return "Ledger correction";
  return "Shared game updated";
}

async function activityForRecipient(
  ctx: QueryCtx | MutationCtx,
  room: Doc<"rooms">,
  recipientKey: string
) {
  const events = await ctx.db
    .query("roomAuditEvents")
    .withIndex("by_room_id_and_created_at", (index) => index.eq("roomId", room._id))
    .order("desc")
    .take(MAX_PUBLIC_SHARED_AUDIT_EVENTS);
  const cursor = await ctx.db
    .query("roomNotificationCursors")
    .withIndex("by_room_id_and_recipient_key", (index) =>
      index.eq("roomId", room._id).eq("recipientKey", recipientKey)
    )
    .unique();
  const lastReadVersion = cursor?.lastReadVersion ?? 0;
  const publicEvents = events.map((event) => ({
    id: event.eventId,
    version: event.version,
    actionType: event.actionType,
    kind: event.kind,
    summary: event.summary,
    transactionIds: event.transactionIds,
    playerIds: event.playerIds,
    actorLabel: event.actorLabel,
    createdAt: event.createdAt,
    notify: event.notify
  }));
  const notifications = events
    .filter((event) => event.notify)
    .map((event) => ({
      id: `notification_${event.eventId}`,
      eventId: event.eventId,
      title: notificationTitle(event.kind),
      summary: event.summary,
      playerIds: event.playerIds,
      createdAt: event.createdAt,
      version: event.version,
      read: event.version <= lastReadVersion
    }));

  return {
    events: publicEvents,
    notifications,
    unreadNotificationCount: notifications.filter((notification) => !notification.read).length
  };
}

async function publicRoomWithActivity<T extends Record<string, unknown> = Record<never, never>>(
  ctx: QueryCtx | MutationCtx,
  room: Doc<"rooms">,
  state: GameState,
  recipientKey: string,
  extra = {} as T
) {
  return publicRoom(room, state, {
    ...extra,
    activity: await activityForRecipient(ctx, room, recipientKey)
  });
}

async function pendingGuestRequests(ctx: QueryCtx | MutationCtx, room: Doc<"rooms">) {
  const requests = await ctx.db
    .query("roomGuestRequests")
    .withIndex("by_room_id_and_status", (index) =>
      index.eq("roomId", room._id).eq("status", "pending")
    )
    .order("desc")
    .take(50);

  return await Promise.all(
    requests.map(async (request) => {
      const guest = await ctx.db.get("roomGuests", request.guestId);
      return {
        id: request._id,
        displayName: guest?.displayName ?? "Guest",
        transaction: request.transaction,
        status: request.status,
        createdAt: request.createdAt
      };
    })
  );
}

async function guestRequestsForGuest(ctx: QueryCtx | MutationCtx, guest: Doc<"roomGuests">) {
  return (await ctx.db
    .query("roomGuestRequests")
    .withIndex("by_guest_id", (index) => index.eq("guestId", guest._id))
    .order("desc")
    .take(20))
    .map((request) => ({
      id: request._id,
      transaction: request.transaction,
      status: request.status,
      createdAt: request.createdAt,
      decidedAt: request.decidedAt ?? null
    }));
}

async function roomByPublicId(ctx: QueryCtx | MutationCtx, publicId: string) {
  return await ctx.db
    .query("rooms")
    .withIndex("by_public_id", (index) => index.eq("publicId", publicId))
    .unique();
}

async function requireHost(ctx: QueryCtx | MutationCtx, publicId: string, hostSecret: string) {
  if (!validSecret(hostSecret)) {
    fail("INVALID_CAPABILITY", "Host capability is invalid.");
  }
  const room = await roomByPublicId(ctx, publicId);
  if (!room) fail("ROOM_NOT_FOUND", "Shared room was not found.");
  const presentedHash = await hashSecret(hostSecret);
  if (!sameHash(room.hostSecretHash, presentedHash)) {
    fail("INVALID_CAPABILITY", "Host capability is invalid.");
  }
  return room;
}

async function requireGuest(ctx: QueryCtx | MutationCtx, publicId: string, guestSecret: string) {
  if (!validSecret(guestSecret)) {
    fail("INVALID_CAPABILITY", "Guest capability is invalid.");
  }
  const room = await roomByPublicId(ctx, publicId);
  if (!room) fail("ROOM_NOT_FOUND", "Shared room was not found.");
  const secretHash = await hashSecret(guestSecret);
  const guest = await ctx.db
    .query("roomGuests")
    .withIndex("by_room_id_and_guest_secret_hash", (index) =>
      index.eq("roomId", room._id).eq("guestSecretHash", secretHash)
    )
    .unique();
  if (!guest || guest.revokedAt !== undefined) {
    fail("INVALID_CAPABILITY", "Guest session is invalid or revoked.");
  }
  return { room, guest };
}

function publicRoom<T extends Record<string, unknown> = Record<never, never>>(
  room: Doc<"rooms">,
  state: GameState,
  extra = {} as T
) {
  const normalizedState = normalizeGameState(state);
  return {
    publicId: room.publicId,
    status: room.status,
    name: room.name,
    state: normalizedState,
    version: room.version,
    endedAt: room.endedAt ?? null,
    ...extra
  };
}

export const create = mutation({
  args: {
    publicId: v.string(),
    localGameId: v.string(),
    snapshot: v.any(),
    hostSecret: v.string(),
    inviteSecret: v.string(),
    controllerId: v.string()
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    if (
      !validIdentifier(args.publicId) ||
      !validIdentifier(args.localGameId) ||
      !validIdentifier(args.controllerId) ||
      !validSecret(args.hostSecret) ||
      !validSecret(args.inviteSecret) ||
      args.hostSecret === args.inviteSecret
    ) {
      fail("INVALID_ARGUMENT", "Room identifiers or capabilities are invalid.");
    }

    const stateError = roomStateError(args.snapshot);
    if (stateError) fail("INVALID_ARGUMENT", stateError);
    const snapshot = normalizeGameState(args.snapshot as GameState);
    if (snapshot.localGameId !== args.localGameId) {
      fail("INVALID_ARGUMENT", "Local game identity does not match the snapshot.");
    }
    const name = snapshot.settings.gameName.trim().slice(0, 80) || "Poker Night";

    const existingPublicRoom = await roomByPublicId(ctx, args.publicId);
    if (existingPublicRoom) fail("INVALID_ARGUMENT", "Room identifier is already in use.");
    const existingLocalRoom = await ctx.db
      .query("rooms")
      .withIndex("by_local_game_id_and_status", (index) =>
        index.eq("localGameId", args.localGameId).eq("status", "active")
      )
      .first();
    if (existingLocalRoom) {
      fail("ROOM_LIMIT_REACHED", "This local game already has an active shared room.");
    }

    const now = Date.now();
    const roomId = await ctx.db.insert("rooms", {
      publicId: args.publicId,
      status: "active",
      name,
      localGameId: args.localGameId,
      state: snapshot,
      version: 0,
      acceptedActionCount: 0,
      createdAt: now,
      hostSecretHash: await hashSecret(args.hostSecret),
      inviteSecretHash: await hashSecret(args.inviteSecret),
      joiningOpen: true,
      hostControllerId: args.controllerId
    });
    await ctx.db.insert("roomNotificationCursors", {
      roomId,
      recipientKey: HOST_RECIPIENT_KEY,
      lastReadVersion: 0,
      updatedAt: now
    });
    await appendAuditEvent(ctx, roomId, {
      eventId: `event_${crypto.randomUUID()}`,
      version: 0,
      actionType: "create_room",
      kind: "game",
      summary: "Created shared room",
      transactionIds: [],
      playerIds: [],
      actorLabel: "Host",
      createdAt: now,
      notify: false
    });
    return {
      publicId: args.publicId,
      status: "active" as const,
      name,
      state: snapshot,
      version: 0,
      endedAt: null
    };
  }
});

export const invitePreview = query({
  args: { publicId: v.string(), inviteSecret: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    if (!validSecret(args.inviteSecret)) {
      return { status: "invalid" as const };
    }
    const room = await roomByPublicId(ctx, args.publicId);
    if (!room) return { status: "invalid" as const };
    const presentedHash = await hashSecret(args.inviteSecret);
    if (!sameHash(room.inviteSecretHash, presentedHash)) {
      return { status: "invalid" as const };
    }
    if (room.joiningOpen === false && room.status === "active") {
      return { status: "closed" as const, name: room.name };
    }
    return { status: room.status, name: room.name };
  }
});

export const join = mutation({
  args: {
    publicId: v.string(),
    inviteSecret: v.string(),
    guestSecret: v.string(),
    displayName: v.string()
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    if (!validSecret(args.inviteSecret) || !validSecret(args.guestSecret)) {
      fail("INVALID_CAPABILITY", "Invitation is invalid.");
    }
    const room = await roomByPublicId(ctx, args.publicId);
    if (!room) fail("ROOM_NOT_FOUND", "Shared room was not found.");
    if (room.status !== "active") fail("ROOM_ENDED", "This shared room has ended.");
    if (room.joiningOpen === false) fail("ROOM_NOT_ACTIVE", "This room is not accepting new guests.");
    const inviteHash = await hashSecret(args.inviteSecret);
    if (!sameHash(room.inviteSecretHash, inviteHash)) {
      fail("INVALID_CAPABILITY", "Invitation is invalid.");
    }
    const displayName = args.displayName.trim();
    if (displayName.length < 1 || displayName.length > 40) {
      fail("INVALID_ARGUMENT", "Display name must be between 1 and 40 characters.");
    }

    const guestSecretHash = await hashSecret(args.guestSecret);
    const existingGuest = await ctx.db
      .query("roomGuests")
      .withIndex("by_room_id_and_guest_secret_hash", (index) =>
        index.eq("roomId", room._id).eq("guestSecretHash", guestSecretHash)
      )
      .unique();
    const now = Date.now();
    let guestId = existingGuest?._id;
    if (existingGuest && existingGuest.revokedAt === undefined) {
      await ctx.db.patch(existingGuest._id, { displayName });
    } else {
      const guests = await ctx.db
        .query("roomGuests")
        .withIndex("by_room_id", (index) => index.eq("roomId", room._id))
        .take(MAX_ROOM_GUESTS + 1);
      if (guests.filter((guest) => guest.revokedAt === undefined).length >= MAX_ROOM_GUESTS) {
        fail("ROOM_LIMIT_REACHED", "This room has reached its guest limit.");
      }
      guestId = await ctx.db.insert("roomGuests", {
        roomId: room._id,
        displayName,
        guestSecretHash,
        joinedAt: now
      });
    }
    if (!guestId) {
      fail("INVALID_CAPABILITY", "Guest session could not be created.");
    }
    const guestRecipientKey = String(guestId);
    const existingCursor = await ctx.db
      .query("roomNotificationCursors")
      .withIndex("by_room_id_and_recipient_key", (index) =>
        index.eq("roomId", room._id).eq("recipientKey", guestRecipientKey)
      )
      .unique();
    if (!existingCursor) {
      await ctx.db.insert("roomNotificationCursors", {
        roomId: room._id,
        recipientKey: guestRecipientKey,
        lastReadVersion: room.version,
        updatedAt: now
      });
    }
    return await publicRoomWithActivity(
      ctx,
      room,
      sanitizeGuestState(room.state as GameState),
      guestRecipientKey,
      { displayName }
    );
  }
});

export const guestView = query({
  args: { publicId: v.string(), guestSecret: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const { room, guest } = await requireGuest(ctx, args.publicId, args.guestSecret);
    return await publicRoomWithActivity(
      ctx,
      room,
      sanitizeGuestState(room.state as GameState),
      String(guest._id),
      {
        displayName: guest.displayName,
        guestRequests: await guestRequestsForGuest(ctx, guest)
      }
    );
  }
});

export const submitGuestTransaction = mutation({
  args: {
    publicId: v.string(),
    guestSecret: v.string(),
    transaction: v.any()
  },
  returns: v.id("roomGuestRequests"),
  handler: async (ctx, args) => {
    const { room, guest } = await requireGuest(ctx, args.publicId, args.guestSecret);
    if (room.status !== "active") fail("ROOM_NOT_ACTIVE", "This room is no longer active.");
    const candidate = applyHostedAction(
      room.state as GameState,
      { type: "add_transaction", transaction: args.transaction },
      new Date().toISOString(),
      () => `transaction_${crypto.randomUUID()}`
    );
    if ("error" in candidate) fail("INVALID_ARGUMENT", candidate.error);

    const pending = await ctx.db
      .query("roomGuestRequests")
      .withIndex("by_guest_id", (index) => index.eq("guestId", guest._id))
      .order("desc")
      .take(25);
    if (pending.filter((request) => request.status === "pending").length >= 10) {
      fail("ROOM_LIMIT_REACHED", "Wait for the host to review your pending requests.");
    }

    return await ctx.db.insert("roomGuestRequests", {
      roomId: room._id,
      guestId: guest._id,
      transaction: args.transaction,
      status: "pending",
      createdAt: Date.now()
    });
  }
});

export const heartbeat = mutation({
  args: { publicId: v.string(), guestSecret: v.string(), sessionId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { room, guest } = await requireGuest(ctx, args.publicId, args.guestSecret);
    if (room.status === "active" && validIdentifier(args.sessionId)) {
      await presence.heartbeat(ctx, room.publicId, String(guest._id), args.sessionId, 30_000);
    }
    return null;
  }
});

export const hostView = query({
  args: { publicId: v.string(), hostSecret: v.string(), controllerId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const room = await requireHost(ctx, args.publicId, args.hostSecret);
    const presentGuests = await presence.listRoom(ctx, room.publicId, true, MAX_ROOM_GUESTS);
    const onlineGuestIds = new Set(presentGuests.map((guest) => guest.userId));
    const guestDocs = await ctx.db
      .query("roomGuests")
      .withIndex("by_room_id", (index) => index.eq("roomId", room._id))
      .order("desc")
      .take(MAX_ROOM_GUESTS);
    const guestCount = presentGuests.length;
    return await publicRoomWithActivity(ctx, room, room.state as GameState, HOST_RECIPIENT_KEY, {
      guestCount,
      joiningOpen: room.joiningOpen !== false,
      guests: guestDocs.map((guest) => ({
        id: guest._id,
        displayName: guest.displayName,
        joinedAt: guest.joinedAt,
        connected: onlineGuestIds.has(String(guest._id)),
        revoked: guest.revokedAt !== undefined
      })),
      guestRequests: await pendingGuestRequests(ctx, room),
      controllerStatus:
        room.hostControllerId === args.controllerId
          ? ("active" as const)
          : ("duplicate" as const)
    });
  }
});

export const setJoiningOpen = mutation({
  args: {
    publicId: v.string(),
    hostSecret: v.string(),
    open: v.boolean()
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const room = await requireHost(ctx, args.publicId, args.hostSecret);
    if (room.status !== "active") fail("ROOM_NOT_ACTIVE", "This room is no longer active.");
    await ctx.db.patch(room._id, { joiningOpen: args.open });
    return null;
  }
});

export const rotateInvite = mutation({
  args: {
    publicId: v.string(),
    hostSecret: v.string(),
    inviteSecret: v.string()
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const room = await requireHost(ctx, args.publicId, args.hostSecret);
    if (room.status !== "active") fail("ROOM_NOT_ACTIVE", "This room is no longer active.");
    if (!validSecret(args.inviteSecret) || args.inviteSecret === args.hostSecret) {
      fail("INVALID_ARGUMENT", "New invitation capability is invalid.");
    }
    await ctx.db.patch(room._id, {
      inviteSecretHash: await hashSecret(args.inviteSecret),
      joiningOpen: true
    });
    return null;
  }
});

export const revokeGuest = mutation({
  args: {
    publicId: v.string(),
    hostSecret: v.string(),
    guestId: v.id("roomGuests")
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const room = await requireHost(ctx, args.publicId, args.hostSecret);
    const guest = await ctx.db.get("roomGuests", args.guestId);
    if (!guest || guest.roomId !== room._id) fail("INVALID_ARGUMENT", "Guest was not found.");
    if (guest.revokedAt === undefined) {
      await ctx.db.patch(guest._id, { revokedAt: Date.now() });
    }
    return null;
  }
});

export const decideGuestTransaction = mutation({
  args: {
    publicId: v.string(),
    hostSecret: v.string(),
    controllerId: v.string(),
    requestId: v.id("roomGuestRequests"),
    decision: v.union(v.literal("approved"), v.literal("rejected")),
    expectedVersion: v.number()
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const room = await requireHost(ctx, args.publicId, args.hostSecret);
    if (room.status !== "active") fail("ROOM_NOT_ACTIVE", "This room is no longer active.");
    if (room.hostControllerId !== args.controllerId) {
      fail("DUPLICATE_CONTROLLER", "Another tab controls this hosted room.");
    }
    const request = await ctx.db.get("roomGuestRequests", args.requestId);
    if (!request || request.roomId !== room._id || request.status !== "pending") {
      fail("INVALID_ARGUMENT", "This guest request is no longer pending.");
    }
    if (args.decision === "rejected") {
      await ctx.db.patch(request._id, { status: "rejected", decidedAt: Date.now() });
      return null;
    }
    if (args.expectedVersion !== room.version) {
      fail("VERSION_CONFLICT", `Room changed; reload version ${room.version}.`);
    }
    const now = Date.now();
    const action = { type: "add_transaction", transaction: request.transaction };
    const applied = applyHostedAction(
      room.state as GameState,
      action,
      new Date(now).toISOString(),
      () => `transaction_${crypto.randomUUID()}`
    );
    if ("error" in applied) fail("INVALID_ARGUMENT", applied.error);
    const version = room.version + 1;
    const auditEvent = buildAuditEvent(room.state as GameState, applied.state, action, version, now);
    await ctx.db.patch(room._id, {
      state: applied.state,
      version,
      acceptedActionCount: room.acceptedActionCount + 1
    });
    await ctx.db.patch(request._id, { status: "approved", decidedAt: now });
    if (auditEvent) {
      await appendAuditEvent(ctx, room._id, {
        ...auditEvent,
        actorLabel: "Host-approved guest request"
      });
    }
    return null;
  }
});

export const claimHost = mutation({
  args: { publicId: v.string(), hostSecret: v.string(), controllerId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const room = await requireHost(ctx, args.publicId, args.hostSecret);
    if (room.status !== "active") fail("ROOM_NOT_ACTIVE", "This room is no longer active.");
    if (!validIdentifier(args.controllerId)) {
      fail("INVALID_ARGUMENT", "Host controller identity is invalid.");
    }
    await ctx.db.patch(room._id, { hostControllerId: args.controllerId });
    return null;
  }
});

export const applyAction = mutation({
  args: {
    publicId: v.string(),
    hostSecret: v.string(),
    controllerId: v.string(),
    expectedVersion: v.number(),
    clientActionId: v.string(),
    action: v.any()
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const room = await requireHost(ctx, args.publicId, args.hostSecret);
    if (room.status !== "active") fail("ROOM_NOT_ACTIVE", "This room is no longer active.");
    if (room.hostControllerId !== args.controllerId) {
      fail("DUPLICATE_CONTROLLER", "Another tab controls this hosted room.");
    }
    if (!validIdentifier(args.clientActionId)) {
      fail("INVALID_ARGUMENT", "Client action identity is invalid.");
    }

    const processed = await ctx.db
      .query("processedActions")
      .withIndex("by_room_id_and_client_action_id", (index) =>
        index.eq("roomId", room._id).eq("clientActionId", args.clientActionId)
      )
      .unique();
    if (processed) {
      return {
        ...(await publicRoomWithActivity(ctx, room, room.state as GameState, HOST_RECIPIENT_KEY)),
        duplicate: true,
        resultingVersion: processed.resultingVersion
      };
    }
    if (!Number.isSafeInteger(args.expectedVersion) || args.expectedVersion !== room.version) {
      fail("VERSION_CONFLICT", `Room changed; reload version ${room.version}.`);
    }
    if (room.acceptedActionCount >= MAX_ROOM_ACTIONS) {
      fail("ROOM_LIMIT_REACHED", "This room has reached its action limit.");
    }

    const now = Date.now();
    const beforeState = room.state as GameState;
    const applied = applyHostedAction(
      beforeState,
      args.action,
      new Date(now).toISOString(),
      () => `transaction_${crypto.randomUUID()}`
    );
    if ("error" in applied) fail("INVALID_ARGUMENT", applied.error);
    const version = room.version + 1;
    const auditEvent = buildAuditEvent(beforeState, applied.state, args.action, version, now);
    await ctx.db.patch(room._id, {
      state: applied.state,
      name: applied.state.settings.gameName.trim().slice(0, 80) || "Poker Night",
      version,
      acceptedActionCount: room.acceptedActionCount + 1
    });
    await ctx.db.insert("processedActions", {
      roomId: room._id,
      clientActionId: args.clientActionId,
      resultingVersion: version,
      processedAt: now
    });
    if (auditEvent) await appendAuditEvent(ctx, room._id, auditEvent);
    return {
      ...(await publicRoomWithActivity(
        ctx,
        {
          ...room,
          version,
          name: applied.state.settings.gameName.trim().slice(0, 80) || "Poker Night"
        },
        applied.state,
        HOST_RECIPIENT_KEY
      )),
      duplicate: false,
      resultingVersion: version
    };
  }
});

export const acknowledgeHostNotifications = mutation({
  args: {
    publicId: v.string(),
    hostSecret: v.string(),
    throughVersion: v.number()
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const room = await requireHost(ctx, args.publicId, args.hostSecret);
    if (!Number.isSafeInteger(args.throughVersion) || args.throughVersion < 0) {
      fail("INVALID_ARGUMENT", "Notification version is invalid.");
    }
    const throughVersion = Math.min(args.throughVersion, room.version);
    const cursor = await ctx.db
      .query("roomNotificationCursors")
      .withIndex("by_room_id_and_recipient_key", (index) =>
        index.eq("roomId", room._id).eq("recipientKey", HOST_RECIPIENT_KEY)
      )
      .unique();
    const now = Date.now();
    if (cursor) {
      await ctx.db.patch(cursor._id, {
        lastReadVersion: Math.max(cursor.lastReadVersion, throughVersion),
        updatedAt: now
      });
    } else {
      await ctx.db.insert("roomNotificationCursors", {
        roomId: room._id,
        recipientKey: HOST_RECIPIENT_KEY,
        lastReadVersion: throughVersion,
        updatedAt: now
      });
    }
    return null;
  }
});

export const acknowledgeGuestNotifications = mutation({
  args: {
    publicId: v.string(),
    guestSecret: v.string(),
    throughVersion: v.number()
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { room, guest } = await requireGuest(ctx, args.publicId, args.guestSecret);
    if (!Number.isSafeInteger(args.throughVersion) || args.throughVersion < 0) {
      fail("INVALID_ARGUMENT", "Notification version is invalid.");
    }
    const throughVersion = Math.min(args.throughVersion, room.version);
    const recipientKey = String(guest._id);
    const cursor = await ctx.db
      .query("roomNotificationCursors")
      .withIndex("by_room_id_and_recipient_key", (index) =>
        index.eq("roomId", room._id).eq("recipientKey", recipientKey)
      )
      .unique();
    const now = Date.now();
    if (cursor) {
      await ctx.db.patch(cursor._id, {
        lastReadVersion: Math.max(cursor.lastReadVersion, throughVersion),
        updatedAt: now
      });
    } else {
      await ctx.db.insert("roomNotificationCursors", {
        roomId: room._id,
        recipientKey,
        lastReadVersion: throughVersion,
        updatedAt: now
      });
    }
    return null;
  }
});

export const end = mutation({
  args: {
    publicId: v.string(),
    hostSecret: v.string(),
    controllerId: v.string(),
    expectedVersion: v.number(),
    clientActionId: v.string()
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const room = await requireHost(ctx, args.publicId, args.hostSecret);
    if (!validIdentifier(args.clientActionId)) {
      fail("INVALID_ARGUMENT", "Client action identity is invalid.");
    }
    const processed = await ctx.db
      .query("processedActions")
      .withIndex("by_room_id_and_client_action_id", (index) =>
        index.eq("roomId", room._id).eq("clientActionId", args.clientActionId)
      )
      .unique();
    if (processed && room.status === "ended") {
      return await publicRoomWithActivity(ctx, room, room.state as GameState, HOST_RECIPIENT_KEY, {
        duplicate: true
      });
    }
    if (room.status !== "active") fail("ROOM_NOT_ACTIVE", "This room is no longer active.");
    if (room.hostControllerId !== args.controllerId) {
      fail("DUPLICATE_CONTROLLER", "Another tab controls this hosted room.");
    }
    if (!Number.isSafeInteger(args.expectedVersion) || args.expectedVersion !== room.version) {
      fail("VERSION_CONFLICT", `Room changed; reload version ${room.version}.`);
    }
    const endedAt = Date.now();
    await ctx.db.patch(room._id, { status: "ended", endedAt });
    await appendAuditEvent(ctx, room._id, {
      eventId: `event_${crypto.randomUUID()}`,
      version: room.version,
      actionType: "end_room",
      kind: "game",
      summary: "Ended shared room",
      transactionIds: [],
      playerIds: [],
      actorLabel: "Host",
      createdAt: endedAt,
      notify: false
    });
    await ctx.db.insert("processedActions", {
      roomId: room._id,
      clientActionId: args.clientActionId,
      resultingVersion: room.version,
      processedAt: endedAt
    });
    return await publicRoomWithActivity(
      ctx,
      { ...room, status: "ended", endedAt },
      room.state as GameState,
      HOST_RECIPIENT_KEY
    );
  }
});
