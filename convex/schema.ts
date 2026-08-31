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
  }).index("by_room_id_and_client_action_id", ["roomId", "clientActionId"])
});
