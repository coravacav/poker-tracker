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
    lastActivityAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    hostSecretHash: v.string(),
    inviteSecretHash: v.string(),
    joiningOpen: v.optional(v.boolean()),
    hostControllerId: v.string(),
    hostProfileId: v.optional(v.id("friendProfiles")),
    visibleToFriends: v.optional(v.boolean()),
    // Set once the lifecycle job has pruned an ended/expired room's details.
    detailsPrunedAt: v.optional(v.number()),
    // Set once the lifecycle job has removed an old room's revoked guest
    // sessions and guest requests. Good-standing guest sessions are kept.
    guestRecordsPrunedAt: v.optional(v.number()),
    // True while this room holds a slot in the active-room counter. Rooms
    // created before the counter existed are absent and never decrement it.
    countedActive: v.optional(v.boolean())
  })
    .index("by_public_id", ["publicId"])
    .index("by_local_game_id_and_status", ["localGameId", "status"])
    .index("by_status_and_last_activity_at", ["status", "lastActivityAt"])
    .index("by_status_and_details_pruned_at_and_last_activity_at", [
      "status",
      "detailsPrunedAt",
      "lastActivityAt"
    ])
    .index("by_status_and_guest_records_pruned_at_and_last_activity_at", [
      "status",
      "guestRecordsPrunedAt",
      "lastActivityAt"
    ]),

  // Small denormalized counters, one row per name (e.g. "activeRooms").
  roomCounters: defineTable({
    name: v.string(),
    value: v.number()
  }).index("by_name", ["name"]),

  friendProfiles: defineTable({
    friendCode: v.string(),
    displayName: v.string(),
    ownerSecretHash: v.string(),
    // Deprecated single-room pointer; superseded by friendRoomListings. No
    // longer written, read only to discover rooms created before listings.
    activeRoomId: v.optional(v.id("rooms")),
    friendCodeRotatedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number()
  }).index("by_friend_code", ["friendCode"]),

  // One row per room that followers of its host may currently discover.
  friendRoomListings: defineTable({
    hostProfileId: v.id("friendProfiles"),
    roomId: v.id("rooms"),
    publicId: v.string(),
    name: v.string(),
    roomCreatedAt: v.number()
  })
    .index("by_host_profile_id", ["hostProfileId"])
    .index("by_room_id", ["roomId"]),

  roomGuests: defineTable({
    roomId: v.id("rooms"),
    displayName: v.string(),
    guestSecretHash: v.string(),
    joinedAt: v.number(),
    revokedAt: v.optional(v.number())
  })
    .index("by_room_id", ["roomId"])
    .index("by_room_id_and_guest_secret_hash", ["roomId", "guestSecretHash"])
    .index("by_room_id_and_revoked_at", ["roomId", "revokedAt"]),

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
