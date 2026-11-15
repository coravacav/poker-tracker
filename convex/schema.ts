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
    // The version the host last wrote (or, for rooms that predate it, absent:
    // read as `version`). Server-authored writes such as agreed entries bump
    // only `version`, so a host action sent against a version in between can
    // still be rebased onto the latest state when it is safe to.
    hostBaseVersion: v.optional(v.number()),
    acceptedActionCount: v.number(),
    createdAt: v.number(),
    lastActivityAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    hostSecretHash: v.string(),
    inviteSecretHash: v.string(),
    // Verifier for the read-only watch link; absent while the link is off.
    spectatorSecretHash: v.optional(v.string()),
    // The player id of the host's own seat ("This is me"); guests can't claim
    // it. Absent until the host picks one; ignored while that player is not
    // an active player.
    hostPlayerId: v.optional(v.string()),
    // The host said they aren't playing, so the share dialog stops asking
    // which seat is theirs. Cleared when they pick a seat.
    hostNotPlaying: v.optional(v.boolean()),
    // Seats the host released a phone from. No phone may claim one on its
    // own (whatever guest record it uses); the host's assign/Move fills it
    // and lifts the block.
    releasedSeatPlayerIds: v.optional(v.array(v.string())),
    // A one-time link (verifier and expiry) the host opens on their own phone
    // to seat it on the host's seat. Cleared once used.
    hostPhoneLinkHash: v.optional(v.string()),
    hostPhoneLinkExpiresAt: v.optional(v.number()),
    // "Players confirm each other": seated guests record give/buy/bank entries
    // by agreeing between themselves (roomAgreements). Rooms the current
    // client creates start with it on; absent means off (host approves).
    peerConfirm: v.optional(v.boolean()),
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

  // At most one row per maintenance job (e.g. "roomLifecycle"): the token of
  // the batch chain currently allowed to run, so overlapping cron runs and
  // continuations never process the backlog twice in parallel.
  maintenanceLeases: defineTable({
    name: v.string(),
    token: v.string(),
    renewedAt: v.number()
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
    revokedAt: v.optional(v.number()),
    // The seat (player id) this phone claimed, when, and who that player was
    // at the time (name and people link). One phone per seat. A host change
    // that renames, relinks, archives or removes the player releases the
    // claim; a claim whose player no longer matches never counts. Revoking a
    // guest clears it.
    playerId: v.optional(v.string()),
    claimedAt: v.optional(v.number()),
    claimedName: v.optional(v.string()),
    claimedPersonId: v.optional(v.string()),
    // Why this phone last lost its seat, shown on its "Pick your seat" prompt.
    seatLost: v.optional(v.union(v.literal("released"), v.literal("changed"))),
    // The host's own phone, seated on the host's seat through the host's
    // one-time phone link. Only such a phone ever holds the host's seat.
    hostPhone: v.optional(v.boolean()),
    // Deprecated: per-phone release blocks, superseded by
    // rooms.releasedSeatPlayerIds. No longer written or read.
    hostReleasedPlayerIds: v.optional(v.array(v.string()))
  })
    .index("by_room_id", ["roomId"])
    .index("by_room_id_and_guest_secret_hash", ["roomId", "guestSecretHash"])
    .index("by_room_id_and_revoked_at", ["roomId", "revokedAt"])
    .index("by_room_id_and_player_id", ["roomId", "playerId"]),

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
    .index("by_guest_id_and_status", ["guestId", "status"]),

  // An entry one seated guest proposed and another player confirms: "give"
  // and "buy" are player_gave entries with the counterparty seat, "bank" is a
  // bank_buy_in for the proposer that any other seated player (or the named
  // witness, or the host) saw. Recorded by the server once confirmed; the
  // host only steps in for seats with no phone and for bounced entries.
  roomAgreements: defineTable({
    roomId: v.id("rooms"),
    kind: v.union(v.literal("give"), v.literal("buy"), v.literal("bank")),
    amountCents: v.number(),
    note: v.optional(v.string()),
    proposerGuestId: v.id("roomGuests"),
    proposerPlayerId: v.string(),
    // give/buy: the other player's seat.
    counterpartyPlayerId: v.optional(v.string()),
    // bank: the one seat whose phone may say "I saw it" (the host can too).
    witnessPlayerId: v.optional(v.string()),
    // The phone holding the counterparty (or named witness) seat when this
    // was proposed, and when it claimed the seat. Only that same claim may
    // answer; absent means the seat had no phone then, so only the host can.
    seatGuestId: v.optional(v.id("roomGuests")),
    seatClaimedAt: v.optional(v.number()),
    // "bounced": a player said it wasn't right and it waits on the host.
    // "returned": the host said Not right or dismissed it, so it is back
    // with the proposer only. Both show as bounced to the proposer.
    status: v.union(
      v.literal("open"),
      v.literal("bounced"),
      v.literal("returned"),
      v.literal("cancelled"),
      v.literal("expired"),
      v.literal("dismissed"),
      v.literal("recorded")
    ),
    // Why a cancelled entry was closed.
    closedReason: v.optional(v.union(
      v.literal("proposer"),
      v.literal("seat_lost"),
      // The counterparty or named witness seat lost its phone or changed.
      v.literal("counterparty_seat_lost"),
      v.literal("revoked"),
      v.literal("ended"),
      v.literal("peer_confirm_off"),
      v.literal("invalid")
    )),
    bounceReason: v.optional(v.string()),
    clientRequestId: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
    decidedAt: v.optional(v.number()),
    // The guest who confirmed or bounced it, or the host.
    decidedByGuestId: v.optional(v.id("roomGuests")),
    decidedByHost: v.optional(v.boolean()),
    confirmedByPlayerId: v.optional(v.string()),
    confirmedVia: v.optional(v.union(v.literal("peer"), v.literal("host"))),
    // The host dismissed a bounced entry (now "returned").
    hostDismissedAt: v.optional(v.number()),
    appliedTransactionId: v.optional(v.string())
  })
    .index("by_room_id_and_status_and_kind", ["roomId", "status", "kind"])
    .index("by_room_id_and_status_and_decided_at", ["roomId", "status", "decidedAt"])
    .index("by_room_id_and_status_and_witness_player_id", [
      "roomId",
      "status",
      "witnessPlayerId"
    ])
    .index("by_room_id_and_status_and_counterparty_player_id", [
      "roomId",
      "status",
      "counterpartyPlayerId"
    ])
    .index("by_proposer_guest_id_and_status", ["proposerGuestId", "status"])
    .index("by_proposer_guest_id_and_client_request_id", ["proposerGuestId", "clientRequestId"])
    .index("by_decided_by_guest_id_and_status", ["decidedByGuestId", "status"]),

  // Browser errors reported by the app (see convex/clientErrors.ts), one row
  // per distinct error per build, counting repeats. No game data is stored.
  clientErrors: defineTable({
    fingerprint: v.string(),
    kind: v.union(v.literal("error"), v.literal("rejection"), v.literal("render")),
    message: v.string(),
    stack: v.optional(v.string()),
    // Latest page path (no query or fragment) and browser it was seen on.
    path: v.string(),
    userAgent: v.string(),
    build: v.string(),
    count: v.number(),
    firstSeenAt: v.number(),
    lastSeenAt: v.number()
  })
    .index("by_fingerprint", ["fingerprint"])
    .index("by_last_seen_at", ["lastSeenAt"])
});
