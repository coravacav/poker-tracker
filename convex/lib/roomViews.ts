// Room projections returned to hosts and guests.
import type { GameState } from "../../src/domain/pokerTypes";
import { MAX_ROOM_GUESTS, normalizeGameState, sanitizeGuestState } from "../../src/session/roomProtocol";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { publicHostProfile } from "./friendDiscovery";
import { requireGuest, requireHost } from "./roomAccess";
import { activityForRecipient, HOST_RECIPIENT_KEY } from "./roomNotifications";
import { presence } from "./roomPresence";

export async function publicRoomWithActivity<T extends Record<string, unknown> = Record<never, never>>(
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

export function publicRoom<T extends Record<string, unknown> = Record<never, never>>(
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

export async function guestRoomView(
  ctx: QueryCtx,
  args: { publicId: string; guestSecret: string }
) {
  const { room, guest } = await requireGuest(ctx, args.publicId, args.guestSecret);
  return await publicRoomWithActivity(
    ctx,
    room,
    sanitizeGuestState(room.state as GameState),
    String(guest._id),
    {
      displayName: guest.displayName,
      hostProfile: await publicHostProfile(ctx, room),
      guestRequests: await guestRequestsForGuest(ctx, guest)
    }
  );
}

export async function roomHistoryView(
  ctx: QueryCtx,
  args: { publicId: string; role: "host" | "guest"; secret: string }
) {
  if (args.role === "host") {
    const room = await requireHost(ctx, args.publicId, args.secret);
    return {
      ...publicRoom(room, room.state as GameState),
      role: "host" as const,
      createdAt: room.createdAt,
      displayName: null
    };
  }
  const { room, guest } = await requireGuest(ctx, args.publicId, args.secret);
  return {
    ...publicRoom(room, sanitizeGuestState(room.state as GameState)),
    role: "guest" as const,
    createdAt: room.createdAt,
    displayName: guest.displayName
  };
}

export async function hostRoomView(
  ctx: QueryCtx,
  args: { publicId: string; hostSecret: string; controllerId: string }
) {
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
    visibleToFriends: room.visibleToFriends === true,
    friendProfileLinked: room.hostProfileId !== undefined,
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
