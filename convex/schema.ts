import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  rooms: defineTable({
    publicId: v.string(),
    status: v.union(v.literal("active"), v.literal("ended"), v.literal("expired")),
    name: v.string(),
    localGameId: v.string(),
    state: v.any(),
    version: v.number(),
    acceptedActionCount: v.number(),
    createdAt: v.number(),
    endedAt: v.optional(v.number()),
    hostSecretHash: v.string(),
    inviteSecretHash: v.string(),
    hostControllerId: v.string()
  })
    .index("by_public_id", ["publicId"])
    .index("by_local_game_id_and_status", ["localGameId", "status"]),

  roomGuests: defineTable({
    roomId: v.id("rooms"),
    displayName: v.string(),
    guestSecretHash: v.string(),
    joinedAt: v.number(),
    revokedAt: v.optional(v.number())
  })
    .index("by_room_id", ["roomId"])
    .index("by_room_id_and_guest_secret_hash", ["roomId", "guestSecretHash"]),

  processedActions: defineTable({
    roomId: v.id("rooms"),
    clientActionId: v.string(),
    resultingVersion: v.number(),
    processedAt: v.number()
  }).index("by_room_id_and_client_action_id", ["roomId", "clientActionId"]),

  roomAuditEvents: defineTable({
    roomId: v.id("rooms"),
    eventId: v.string(),
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
  })
    .index("by_room_id_and_created_at", ["roomId", "createdAt"])
    .index("by_room_id_and_version", ["roomId", "version"]),

  roomNotificationCursors: defineTable({
    roomId: v.id("rooms"),
    recipientKey: v.string(),
    lastReadVersion: v.number(),
    updatedAt: v.number()
  }).index("by_room_id_and_recipient_key", ["roomId", "recipientKey"]),

  roomGuestRequests: defineTable({
    roomId: v.id("rooms"),
    guestId: v.id("roomGuests"),
    transaction: v.any(),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected")
    ),
    createdAt: v.number(),
    decidedAt: v.optional(v.number())
  })
    .index("by_room_id_and_status", ["roomId", "status"])
    .index("by_guest_id", ["guestId"])
});
