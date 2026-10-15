// Return-value validators shared by the public functions in convex/rooms.ts.
import { v } from "convex/values";

export const roomStatusValidator = v.union(
  v.literal("active"),
  v.literal("ended"),
  v.literal("expired")
);
export const publicRoomValidator = v.object({
  publicId: v.string(),
  status: roomStatusValidator,
  name: v.string(),
  state: v.any(),
  version: v.number(),
  endedAt: v.union(v.number(), v.null())
});
export const activityValidator = v.object({
  events: v.array(v.object({
    id: v.string(),
    version: v.number(),
    actionType: v.string(),
    kind: v.union(
      v.literal("transaction"),
      v.literal("cash_out"),
      v.literal("correction"),
      v.literal("game")
    ),
    summary: v.string(),
    transactionIds: v.array(v.string()),
    playerIds: v.array(v.string()),
    actorLabel: v.string(),
    createdAt: v.number(),
    notify: v.boolean()
  })),
  notifications: v.array(v.object({
    id: v.string(),
    eventId: v.string(),
    title: v.string(),
    summary: v.string(),
    playerIds: v.array(v.string()),
    createdAt: v.number(),
    version: v.number(),
    read: v.boolean()
  })),
  unreadNotificationCount: v.number()
});
export const guestRoomValidator = publicRoomValidator.extend({
  displayName: v.string(),
  hostProfile: v.union(
    v.null(),
    v.object({ friendCode: v.string(), displayName: v.string() })
  ),
  activity: activityValidator
});
export const guestViewValidator = guestRoomValidator.extend({
  guestRequests: v.array(v.object({
    id: v.id("roomGuestRequests"),
    transaction: v.any(),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected")
    ),
    createdAt: v.number(),
    decidedAt: v.union(v.number(), v.null())
  }))
});
export const invitePreviewValidator = v.union(
  v.object({ status: v.literal("invalid") }),
  v.object({
    status: v.union(roomStatusValidator, v.literal("closed")),
    name: v.string()
  })
);
export const historyViewValidator = publicRoomValidator.extend({
  role: v.union(v.literal("host"), v.literal("guest")),
  createdAt: v.number(),
  displayName: v.union(v.string(), v.null())
});
export const hostActionResultValidator = publicRoomValidator.extend({
  activity: activityValidator,
  duplicate: v.boolean(),
  resultingVersion: v.number()
});
export const endResultValidator = publicRoomValidator.extend({
  activity: activityValidator,
  duplicate: v.optional(v.boolean())
});
export const hostRoomValidator = publicRoomValidator.extend({
  activity: activityValidator,
  guestCount: v.number(),
  joiningOpen: v.boolean(),
  visibleToFriends: v.boolean(),
  friendProfileLinked: v.boolean(),
  guests: v.array(v.object({
    id: v.id("roomGuests"),
    displayName: v.string(),
    joinedAt: v.number(),
    connected: v.boolean(),
    revoked: v.boolean()
  })),
  guestRequests: v.array(v.object({
    id: v.id("roomGuestRequests"),
    displayName: v.string(),
    transaction: v.any(),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected")
    ),
    createdAt: v.number()
  })),
  controllerStatus: v.union(v.literal("active"), v.literal("duplicate"))
});
