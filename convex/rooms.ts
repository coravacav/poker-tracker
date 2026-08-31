import { Presence } from "@convex-dev/presence";
import { ConvexError, v } from "convex/values";
import type { GameState } from "../src/domain/pokerTypes";
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

type RoomErrorCode =
  | "INVALID_ARGUMENT"
  | "INVALID_CAPABILITY"
  | "ROOM_NOT_FOUND"
  | "ROOM_NOT_ACTIVE"
  | "ROOM_ENDED"
  | "VERSION_CONFLICT"
  | "DUPLICATE_CONTROLLER"
  | "ROOM_LIMIT_REACHED";

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
    await ctx.db.insert("rooms", {
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
      hostControllerId: args.controllerId
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
      await ctx.db.insert("roomGuests", {
        roomId: room._id,
        displayName,
        guestSecretHash,
        joinedAt: now
      });
    }
    return publicRoom(room, sanitizeGuestState(room.state as GameState), { displayName });
  }
});

export const guestView = query({
  args: { publicId: v.string(), guestSecret: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const { room, guest } = await requireGuest(ctx, args.publicId, args.guestSecret);
    return publicRoom(room, sanitizeGuestState(room.state as GameState), {
      displayName: guest.displayName
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
    const guests = await presence.listRoom(ctx, room.publicId, true, MAX_ROOM_GUESTS);
    const guestCount = guests.length;
    return publicRoom(room, room.state as GameState, {
      guestCount,
      controllerStatus:
        room.hostControllerId === args.controllerId
          ? ("active" as const)
          : ("duplicate" as const)
    });
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
        ...publicRoom(room, room.state as GameState),
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
    const applied = applyHostedAction(
      room.state as GameState,
      args.action,
      new Date(now).toISOString(),
      () => `transaction_${crypto.randomUUID()}`
    );
    if ("error" in applied) fail("INVALID_ARGUMENT", applied.error);
    const version = room.version + 1;
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
    return {
      ...publicRoom(
        {
          ...room,
          version,
          name: applied.state.settings.gameName.trim().slice(0, 80) || "Poker Night"
        },
        applied.state
      ),
      duplicate: false,
      resultingVersion: version
    };
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
      return publicRoom(room, room.state as GameState, { duplicate: true });
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
    await ctx.db.insert("processedActions", {
      roomId: room._id,
      clientActionId: args.clientActionId,
      resultingVersion: room.version,
      processedAt: endedAt
    });
    return publicRoom({ ...room, status: "ended", endedAt }, room.state as GameState);
  }
});
