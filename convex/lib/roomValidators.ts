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
export const activityEventValidator = v.object({
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
});
export const activityValidator = v.object({
  events: v.array(activityEventValidator),
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
/**
 * A seat someone with the invitation can pick. `claimed` means another phone
 * holds it; other guests' names and ids are never included.
 */
export const seatOptionValidator = v.object({
  playerId: v.string(),
  name: v.string(),
  claimed: v.boolean(),
  isHost: v.boolean(),
  /** The host released this seat; only the host can put a phone there. */
  releasedByHost: v.optional(v.boolean())
});
export const guestRoomValidator = publicRoomValidator.extend({
  displayName: v.string(),
  hostProfile: v.union(
    v.null(),
    v.object({ friendCode: v.string(), displayName: v.string() })
  ),
  activity: activityValidator,
  /** The seat this guest holds, or null. */
  seatPlayerId: v.union(v.string(), v.null()),
  /** Why this guest last lost a seat ("released" by the host, or the player "changed"). */
  seatLost: v.union(v.literal("released"), v.literal("changed"), v.null()),
  seats: v.array(seatOptionValidator)
});
export const agreementStatusValidator = v.union(
  v.literal("open"),
  v.literal("bounced"),
  v.literal("cancelled"),
  v.literal("expired"),
  v.literal("dismissed"),
  v.literal("recorded")
);
export const agreementClosedReasonValidator = v.union(
  v.literal("proposer"),
  v.literal("seat_lost"),
  v.literal("counterparty_seat_lost"),
  v.literal("revoked"),
  v.literal("ended"),
  v.literal("peer_confirm_off"),
  v.literal("invalid")
);
/** What an answer, cancel, or dismiss did to an agreement. */
export const agreementResultValidator = v.object({
  status: agreementStatusValidator,
  reason: v.union(agreementClosedReasonValidator, v.null())
});
/** One agreed (or proposed) entry, with player names from the room's game. */
export const agreementViewValidator = v.object({
  id: v.id("roomAgreements"),
  kind: v.union(v.literal("give"), v.literal("buy"), v.literal("bank")),
  amountCents: v.number(),
  note: v.union(v.string(), v.null()),
  proposerPlayerId: v.string(),
  proposerName: v.string(),
  counterpartyPlayerId: v.union(v.string(), v.null()),
  counterpartyName: v.union(v.string(), v.null()),
  witnessPlayerId: v.union(v.string(), v.null()),
  witnessName: v.union(v.string(), v.null()),
  status: agreementStatusValidator,
  closedReason: v.union(agreementClosedReasonValidator, v.null()),
  bounceReason: v.union(v.string(), v.null()),
  /** Bounced by the host (not a player), so it isn't in the host's Needs you. */
  bouncedByHost: v.boolean(),
  createdAt: v.number(),
  /** Open entries expire then; the server flips them to "expired" shortly after. */
  expiresAt: v.number(),
  decidedAt: v.union(v.number(), v.null()),
  confirmedByPlayerId: v.union(v.string(), v.null()),
  confirmedByName: v.union(v.string(), v.null()),
  confirmedVia: v.union(v.literal("peer"), v.literal("host"), v.null()),
  transactionId: v.union(v.string(), v.null()),
  /** The recorded entry was voided by the host since. */
  voided: v.boolean()
});
export const guestViewValidator = guestRoomValidator.extend({
  /** "Players confirm each other" is on: Chips entries go to other players, not the host. */
  peerConfirm: v.boolean(),
  agreements: v.object({
    /** Open entries this guest can confirm (or say they saw), oldest first. */
    needsMe: v.array(agreementViewValidator),
    /** This guest's open proposals, newest first. */
    mine: v.array(agreementViewValidator),
    /** This guest's proposals someone said weren't right, until dismissed. */
    bounced: v.array(agreementViewValidator),
    /** The latest recorded entries this guest proposed, confirmed, or was the other player in. */
    recentDone: v.array(agreementViewValidator)
  }),
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
    name: v.string(),
    // Only while the room is active and accepting guests.
    seats: v.optional(v.array(seatOptionValidator))
  })
);
export const spectatorViewValidator = publicRoomValidator.extend({
  events: v.array(activityEventValidator)
});
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
  watchLinkOn: v.boolean(),
  watchLinkId: v.union(v.string(), v.null()),
  watcherCount: v.number(),
  guests: v.array(v.object({
    id: v.id("roomGuests"),
    displayName: v.string(),
    joinedAt: v.number(),
    connected: v.boolean(),
    revoked: v.boolean()
  })),
  /** The host's own seat ("This is me"), or null while unset. */
  hostPlayerId: v.union(v.string(), v.null()),
  /** The host said they aren't playing. */
  hostNotPlaying: v.boolean(),
  /** Every active seat in seat order, with the phone holding it. */
  seats: v.array(v.object({
    playerId: v.string(),
    name: v.string(),
    isHost: v.boolean(),
    guest: v.union(
      v.null(),
      v.object({ id: v.id("roomGuests"), displayName: v.string(), connected: v.boolean() })
    )
  })),
  peerConfirm: v.boolean(),
  /** Agreements the host answers or settles. */
  needsHost: v.object({
    /**
     * Open entries the host may answer: "self" for the host's own seat,
     * "seat" for a seat that had no phone when it was sent, "bank" for any
     * bank buy-in.
     */
    answer: v.array(agreementViewValidator.extend({
      answerAs: v.union(v.literal("self"), v.literal("seat"), v.literal("bank"))
    })),
    /** Entries a player said weren't right: Dismiss or Record anyway. */
    bounced: v.array(agreementViewValidator)
  }),
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
