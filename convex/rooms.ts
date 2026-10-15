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
import { lifecycleBatchResultValidator, runLifecycleBatch } from "./lib/roomLifecycle";
import {
  acknowledgeGuestNotificationsForRoom,
  acknowledgeHostNotificationsForRoom
} from "./lib/roomNotifications";
import {
  endResultValidator,
  guestRoomValidator,
  guestViewValidator,
  historyViewValidator,
  hostActionResultValidator,
  hostRoomValidator,
  invitePreviewValidator,
  publicRoomValidator
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
    visibleToFriends: v.optional(v.boolean())
  },
  returns: publicRoomValidator,
  handler: createRoom
});

export const invitePreview = query({
  args: { publicId: v.string(), inviteSecret: v.string() },
  returns: invitePreviewValidator,
  handler: previewInvite
});

export const join = mutation({
  args: {
    publicId: v.string(),
    inviteSecret: v.string(),
    guestSecret: v.string(),
    displayName: v.string()
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

export const revokeGuest = mutation({
  args: {
    publicId: v.string(),
    hostSecret: v.string(),
    guestId: v.id("roomGuests")
  },
  returns: v.null(),
  handler: revokeRoomGuest
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
