// Public and internal Convex functions for shared rooms. Function paths here
// (api.rooms.*, internal.rooms.*) are the client and scheduler API, so every
// registration stays in this module; implementations live in convex/lib/room*.ts.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { applyHostAction, decideGuestRequest } from "./lib/roomActions";
import {
  joinWithFriendCode,
  joinWithInvite,
  previewInvite,
  recordGuestHeartbeat,
  revokeRoomGuest,
  rotateRoomInvite,
  setRoomJoiningOpen,
  submitGuestTransactionRequest
} from "./lib/roomGuests";
import { claimRoomHost, createRoom, endRoom, setRoomFriendVisibility } from "./lib/roomHosting";
import {
  answerRoomAgreement,
  cancelOwnRoomAgreement,
  closeInactiveRoomAgreements,
  dismissOwnRoomAgreement,
  expireRoomAgreement,
  hostAnswerRoomAgreement,
  hostResolveBouncedRoomAgreement,
  proposeRoomAgreement,
  setRoomPeerConfirm
} from "./lib/roomAgreements";
import {
  assignRoomSeat,
  claimRoomSeat,
  releaseRoomSeat,
  setRoomHostPlayer
} from "./lib/roomSeats";
import { lifecycleBatchResultValidator, runLifecycleBatch } from "./lib/roomLifecycle";
import {
  recordSpectatorHeartbeat,
  removeWatcherPresence as removeWatcherPresenceBatches,
  rotateRoomSpectatorLink,
  spectatorRoomView
} from "./lib/roomSpectators";
import {
  acknowledgeGuestNotificationsForRoom,
  acknowledgeHostNotificationsForRoom
} from "./lib/roomNotifications";
import {
  agreementResultValidator,
  endResultValidator,
  guestRoomValidator,
  guestViewValidator,
  historyViewValidator,
  hostActionResultValidator,
  hostRoomValidator,
  invitePreviewValidator,
  publicRoomValidator,
  spectatorViewValidator
} from "./lib/roomValidators";
import { guestRoomView, hostRoomView, roomHistoryView } from "./lib/roomViews";

export const create = mutation({
  args: {
    publicId: v.string(),
    localGameId: v.string(),
    snapshot: v.any(),
    hostSecret: v.string(),
    inviteSecret: v.string(),
    controllerId: v.string(),
    friendCode: v.optional(v.string()),
    profileOwnerSecret: v.optional(v.string()),
    visibleToFriends: v.optional(v.boolean()),
    // "Players confirm each other"; absent (older clients) leaves it off.
    peerConfirm: v.optional(v.boolean())
  },
  returns: publicRoomValidator,
  handler: createRoom
});

export const invitePreview = query({
  args: { publicId: v.string(), inviteSecret: v.string() },
  returns: invitePreviewValidator,
  handler: previewInvite
});

/** Joins with a seat (taking its player's name) or, without one, with a display name. */
export const join = mutation({
  args: {
    publicId: v.string(),
    inviteSecret: v.string(),
    guestSecret: v.string(),
    displayName: v.optional(v.string()),
    playerId: v.optional(v.string())
  },
  returns: guestRoomValidator,
  handler: joinWithInvite
});

export const joinFriend = mutation({
  args: {
    publicId: v.string(),
    friendCode: v.string(),
    guestSecret: v.string(),
    displayName: v.string()
  },
  returns: guestRoomValidator,
  handler: joinWithFriendCode
});

export const guestView = query({
  args: { publicId: v.string(), guestSecret: v.string() },
  returns: guestViewValidator,
  handler: guestRoomView
});

export const historyView = query({
  args: {
    publicId: v.string(),
    role: v.union(v.literal("host"), v.literal("guest")),
    secret: v.string()
  },
  returns: historyViewValidator,
  handler: roomHistoryView
});

export const submitGuestTransaction = mutation({
  args: {
    publicId: v.string(),
    guestSecret: v.string(),
    transaction: v.any()
  },
  returns: v.id("roomGuestRequests"),
  handler: submitGuestTransactionRequest
});

/** A guest takes an open seat, moving off any seat they held. */
export const claimSeat = mutation({
  args: { publicId: v.string(), guestSecret: v.string(), playerId: v.string() },
  returns: v.null(),
  handler: claimRoomSeat
});

/**
 * A seated guest proposes an entry another player confirms ("Players confirm
 * each other" rooms only): give (I gave them chips), buy (I bought chips from
 * them), or bank (I bought in; any other seated player, or the named witness,
 * or the host says "I saw it"). Idempotent on clientRequestId.
 */
export const proposeAgreement = mutation({
  args: {
    publicId: v.string(),
    guestSecret: v.string(),
    kind: v.union(v.literal("give"), v.literal("buy"), v.literal("bank")),
    amountCents: v.number(),
    counterpartyPlayerId: v.optional(v.string()),
    witnessPlayerId: v.optional(v.string()),
    clientRequestId: v.string(),
    note: v.optional(v.string())
  },
  returns: v.id("roomAgreements"),
  handler: proposeRoomAgreement
});

/** The other player confirms (or, for bank, says "I saw it"); the entry is recorded at once. */
export const confirmAgreement = mutation({
  args: { publicId: v.string(), guestSecret: v.string(), agreementId: v.id("roomAgreements") },
  returns: agreementResultValidator,
  handler: (ctx, args) => answerRoomAgreement(ctx, { ...args, answer: "confirm" })
});

/** "Not right" / "I didn't see it": back to the proposer and into the host's Needs you. */
export const bounceAgreement = mutation({
  args: {
    publicId: v.string(),
    guestSecret: v.string(),
    agreementId: v.id("roomAgreements"),
    reason: v.optional(v.string())
  },
  returns: agreementResultValidator,
  handler: (ctx, args) => answerRoomAgreement(ctx, { ...args, answer: "not_right" })
});

/** The proposer takes back an open proposal. */
export const cancelAgreement = mutation({
  args: { publicId: v.string(), guestSecret: v.string(), agreementId: v.id("roomAgreements") },
  returns: agreementResultValidator,
  handler: cancelOwnRoomAgreement
});

/** The proposer clears a bounced proposal from their Inbox. */
export const dismissAgreement = mutation({
  args: { publicId: v.string(), guestSecret: v.string(), agreementId: v.id("roomAgreements") },
  returns: agreementResultValidator,
  handler: dismissOwnRoomAgreement
});

export const heartbeat = mutation({
  args: { publicId: v.string(), guestSecret: v.string(), sessionId: v.string() },
  returns: v.null(),
  handler: recordGuestHeartbeat
});

export const hostView = query({
  args: { publicId: v.string(), hostSecret: v.string(), controllerId: v.string() },
  returns: hostRoomValidator,
  handler: hostRoomView
});

export const setJoiningOpen = mutation({
  args: {
    publicId: v.string(),
    hostSecret: v.string(),
    open: v.boolean()
  },
  returns: v.null(),
  handler: setRoomJoiningOpen
});

export const setFriendVisibility = mutation({
  args: {
    publicId: v.string(),
    hostSecret: v.string(),
    visible: v.boolean()
  },
  returns: v.null(),
  handler: setRoomFriendVisibility
});

export const rotateInvite = mutation({
  args: {
    publicId: v.string(),
    hostSecret: v.string(),
    inviteSecret: v.string()
  },
  returns: v.null(),
  handler: rotateRoomInvite
});

/** Turns the read-only watch link on (or replaces it) with a new secret, or off with null. */
export const rotateSpectatorLink = mutation({
  args: {
    publicId: v.string(),
    hostSecret: v.string(),
    spectatorSecret: v.union(v.string(), v.null())
  },
  returns: v.null(),
  handler: rotateRoomSpectatorLink
});

export const spectatorView = query({
  args: { publicId: v.string(), spectatorSecret: v.string() },
  returns: spectatorViewValidator,
  handler: spectatorRoomView
});

export const spectatorHeartbeat = mutation({
  args: { publicId: v.string(), spectatorSecret: v.string(), sessionId: v.string() },
  returns: v.null(),
  handler: recordSpectatorHeartbeat
});

/** Removes an old watch link's presence rows in batches (rotate, turn off, pruning). */
export const removeWatcherPresence = internalMutation({
  args: { presenceKey: v.string() },
  returns: v.null(),
  handler: removeWatcherPresenceBatches
});

export const revokeGuest = mutation({
  args: {
    publicId: v.string(),
    hostSecret: v.string(),
    guestId: v.id("roomGuests")
  },
  returns: v.null(),
  handler: revokeRoomGuest
});

/** Host: frees the seat a guest's phone holds. */
export const releaseSeat = mutation({
  args: {
    publicId: v.string(),
    hostSecret: v.string(),
    guestId: v.id("roomGuests"),
    // The seat the host saw the phone in; refused if it has moved since.
    playerId: v.string()
  },
  returns: v.null(),
  handler: releaseRoomSeat
});

/** Host: moves a guest's phone to an open seat. */
export const assignSeat = mutation({
  args: {
    publicId: v.string(),
    hostSecret: v.string(),
    guestId: v.id("roomGuests"),
    playerId: v.string()
  },
  returns: v.null(),
  handler: assignRoomSeat
});

/** Host: marks the host's own seat, or says they aren't playing with null. */
export const setHostPlayer = mutation({
  args: {
    publicId: v.string(),
    hostSecret: v.string(),
    playerId: v.union(v.string(), v.null())
  },
  returns: v.null(),
  handler: setRoomHostPlayer
});

/** Host: turns "Players confirm each other" on or off (off cancels open proposals). */
export const setPeerConfirm = mutation({
  args: { publicId: v.string(), hostSecret: v.string(), controllerId: v.string(), on: v.boolean() },
  returns: v.null(),
  handler: setRoomPeerConfirm
});

/**
 * Host: answers an open agreement for the host's own seat, a seat no phone
 * holds, or any bank buy-in. "not_right" sends it back to the proposer.
 */
export const hostConfirmAgreement = mutation({
  args: {
    publicId: v.string(),
    hostSecret: v.string(),
    controllerId: v.string(),
    agreementId: v.id("roomAgreements"),
    answer: v.union(v.literal("confirm"), v.literal("not_right"))
  },
  returns: agreementResultValidator,
  handler: hostAnswerRoomAgreement
});

/** Host: Dismiss a bounced entry, or Record anyway. */
export const hostResolveBounced = mutation({
  args: {
    publicId: v.string(),
    hostSecret: v.string(),
    controllerId: v.string(),
    agreementId: v.id("roomAgreements"),
    decision: v.union(v.literal("dismiss"), v.literal("record"))
  },
  returns: agreementResultValidator,
  handler: hostResolveBouncedRoomAgreement
});

/** Closes an expired room's open and bounced agreements (scheduled by the lifecycle job). */
export const closeRoomAgreements = internalMutation({
  args: { roomId: v.id("rooms") },
  returns: v.null(),
  handler: closeInactiveRoomAgreements
});

/** Expires an agreement nobody answered (scheduled when it is proposed). */
export const expireAgreement = internalMutation({
  args: { agreementId: v.id("roomAgreements") },
  returns: v.null(),
  handler: expireRoomAgreement
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
  handler: decideGuestRequest
});

export const claimHost = mutation({
  args: { publicId: v.string(), hostSecret: v.string(), controllerId: v.string() },
  returns: v.null(),
  handler: claimRoomHost
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
  returns: hostActionResultValidator,
  handler: applyHostAction
});

export const acknowledgeHostNotifications = mutation({
  args: {
    publicId: v.string(),
    hostSecret: v.string(),
    throughVersion: v.number()
  },
  returns: v.null(),
  handler: acknowledgeHostNotificationsForRoom
});

export const acknowledgeGuestNotifications = mutation({
  args: {
    publicId: v.string(),
    guestSecret: v.string(),
    throughVersion: v.number()
  },
  returns: v.null(),
  handler: acknowledgeGuestNotificationsForRoom
});

export const end = mutation({
  args: {
    publicId: v.string(),
    hostSecret: v.string(),
    controllerId: v.string(),
    expectedVersion: v.number(),
    clientActionId: v.string()
  },
  returns: endResultValidator,
  handler: endRoom
});

async function runLifecycleBatchAndContinue(ctx: MutationCtx, chainId: string | undefined) {
  const result = await runLifecycleBatch(ctx, chainId);
  if (result.continues && result.chainId !== null) {
    await ctx.scheduler.runAfter(0, internal.rooms.runRoomLifecycle, {
      continuation: true,
      chainId: result.chainId
    });
  }
  return result;
}

/**
 * Daily room maintenance (expiry, detail pruning, guest-record pruning) as a
 * chain of budgeted batches; see convex/lib/roomLifecycle.ts for the limits
 * math and the lease that keeps a single chain running. `continuation` is
 * accepted for continuations scheduled before chains carried a `chainId`;
 * without a `chainId` a call starts a chain unless one is already live.
 */
export const runRoomLifecycle = internalMutation({
  args: { continuation: v.optional(v.boolean()), chainId: v.optional(v.string()) },
  returns: lifecycleBatchResultValidator,
  handler: async (ctx, args) => {
    return await runLifecycleBatchAndContinue(ctx, args.chainId);
  }
});

/**
 * Deprecated: guest-record pruning is now part of `runRoomLifecycle`. Kept so
 * runs scheduled before that change still resolve; it starts (or defers to)
 * the lifecycle chain.
 */
export const pruneOldGuestRecords = internalMutation({
  args: {},
  returns: lifecycleBatchResultValidator,
  handler: async (ctx) => {
    return await runLifecycleBatchAndContinue(ctx, undefined);
  }
});
