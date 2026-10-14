import { ConvexError, v } from "convex/values";
import { MAX_FOLLOWED_FRIENDS, parseFriendCode } from "../src/session/friendCode";
import {
  CREATION_LIMITED_CODE,
  PROFILE_CREATION_LIMITED_MESSAGE
} from "../src/session/creationLimits";
import type { Doc } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { hashSecret, sameHash, validSecret } from "./lib/capabilities";
import { creationLimiter } from "./lib/creationLimits";
import {
  discoverableRooms,
  profileByFriendCode,
  verifyProfileOwner
} from "./lib/friendDiscovery";

type ProfileErrorCode =
  | "INVALID_ARGUMENT"
  | "INVALID_CAPABILITY"
  | "PROFILE_NOT_FOUND"
  | typeof CREATION_LIMITED_CODE;

function failProfile(code: ProfileErrorCode, message: string): never {
  throw new ConvexError({ code, message });
}

const INVALID_FRIEND_CODE_MESSAGE = "Friend code must contain 20 to 32 valid characters.";

function normalizeDisplayName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

const publicProfileValidator = v.object({
  friendCode: v.string(),
  displayName: v.string()
});

const discoverableRoomValidator = v.object({
  publicId: v.string(),
  name: v.string(),
  createdAt: v.number()
});

const activityProfileValidator = publicProfileValidator.extend({
  /** Newest discoverable room; kept for clients that predate `rooms`. */
  room: v.union(v.null(), discoverableRoomValidator),
  rooms: v.array(discoverableRoomValidator)
});

function validateDisplayName(value: string): string {
  if (value.length > 200) {
    failProfile("INVALID_ARGUMENT", "Display name must be between 1 and 40 characters.");
  }
  const displayName = normalizeDisplayName(value);
  if (displayName.length < 1 || displayName.length > 40) {
    failProfile("INVALID_ARGUMENT", "Display name must be between 1 and 40 characters.");
  }
  return displayName;
}

async function requireProfileOwner(
  ctx: MutationCtx,
  friendCode: string,
  ownerSecret: string
): Promise<Doc<"friendProfiles">> {
  const check = await verifyProfileOwner(ctx, friendCode, ownerSecret);
  if (check.ok) return check.profile;
  if (check.reason === "not_found") failProfile("PROFILE_NOT_FOUND", "Friend profile was not found.");
  if (check.reason === "invalid_argument") {
    failProfile("INVALID_ARGUMENT", "Friend code or profile owner capability is invalid.");
  }
  failProfile("INVALID_CAPABILITY", "Profile owner capability is invalid.");
}

/** Creates a device profile, or idempotently refreshes its name for its owner. */
export const create = mutation({
  args: {
    friendCode: v.string(),
    displayName: v.string(),
    ownerSecret: v.string()
  },
  returns: publicProfileValidator,
  handler: async (ctx, args) => {
    const friendCode = parseFriendCode(args.friendCode);
    if (!friendCode) failProfile("INVALID_ARGUMENT", INVALID_FRIEND_CODE_MESSAGE);
    if (!validSecret(args.ownerSecret)) {
      failProfile("INVALID_ARGUMENT", "Profile owner capability is invalid.");
    }
    const displayName = validateDisplayName(args.displayName);
    const ownerSecretHash = await hashSecret(args.ownerSecret);
    const existing = await profileByFriendCode(ctx, friendCode);
    const now = Date.now();
    if (existing) {
      if (!sameHash(existing.ownerSecretHash, ownerSecretHash)) {
        failProfile("INVALID_CAPABILITY", "Friend code is already in use.");
      }
      if (existing.displayName !== displayName) {
        await ctx.db.patch(existing._id, { displayName, updatedAt: now });
      }
      return { friendCode, displayName };
    }

    // Only genuinely new profiles consume the global creation budget; the
    // owner's idempotent refreshes above are never limited.
    const limit = await creationLimiter.limit(ctx, "friendProfileCreation");
    if (!limit.ok) failProfile(CREATION_LIMITED_CODE, PROFILE_CREATION_LIMITED_MESSAGE);

    await ctx.db.insert("friendProfiles", {
      friendCode,
      displayName,
      ownerSecretHash,
      createdAt: now,
      updatedAt: now
    });
    return { friendCode, displayName };
  }
});

export const lookup = query({
  args: { friendCode: v.string() },
  returns: v.union(publicProfileValidator, v.null()),
  handler: async (ctx, args) => {
    const friendCode = parseFriendCode(args.friendCode);
    if (!friendCode) return null;
    const profile = await profileByFriendCode(ctx, friendCode);
    return profile ? { friendCode: profile.friendCode, displayName: profile.displayName } : null;
  }
});

/**
 * Discovery for followed hosts. Reads at most MAX_FOLLOWED_FRIENDS profiles
 * and a bounded number of small listing rows per profile.
 */
export const listActivity = query({
  args: { friendCodes: v.array(v.string()) },
  returns: v.array(activityProfileValidator),
  handler: async (ctx, args) => {
    if (args.friendCodes.length > MAX_FOLLOWED_FRIENDS) {
      failProfile(
        "INVALID_ARGUMENT",
        `At most ${MAX_FOLLOWED_FRIENDS} friend codes can be checked at once.`
      );
    }
    const friendCodes = [...new Set(
      args.friendCodes.flatMap((value) => {
        const friendCode = parseFriendCode(value);
        return friendCode ? [friendCode] : [];
      })
    )];
    const profiles = await Promise.all(
      friendCodes.map((friendCode) => profileByFriendCode(ctx, friendCode))
    );

    return await Promise.all(
      profiles.flatMap((profile) => profile ? [profile] : []).map(async (profile) => {
        const rooms = await discoverableRooms(ctx, profile);
        return {
          friendCode: profile.friendCode,
          displayName: profile.displayName,
          room: rooms[0] ?? null,
          rooms
        };
      })
    );
  }
});

export const updateName = mutation({
  args: {
    friendCode: v.string(),
    ownerSecret: v.string(),
    displayName: v.string()
  },
  returns: publicProfileValidator,
  handler: async (ctx, args) => {
    const profile = await requireProfileOwner(ctx, args.friendCode, args.ownerSecret);
    const displayName = validateDisplayName(args.displayName);
    await ctx.db.patch(profile._id, { displayName, updatedAt: Date.now() });
    return { friendCode: profile.friendCode, displayName };
  }
});

/**
 * Replaces the profile's friend code. The old code stops resolving at once,
 * which revokes discovery and joining through it; guests of rooms created
 * before the rotation no longer see the host profile (see publicHostProfile).
 */
export const rotateCode = mutation({
  args: {
    friendCode: v.string(),
    ownerSecret: v.string(),
    newFriendCode: v.string()
  },
  returns: publicProfileValidator,
  handler: async (ctx, args) => {
    const profile = await requireProfileOwner(ctx, args.friendCode, args.ownerSecret);
    const newFriendCode = parseFriendCode(args.newFriendCode);
    if (!newFriendCode) failProfile("INVALID_ARGUMENT", INVALID_FRIEND_CODE_MESSAGE);
    if (newFriendCode !== profile.friendCode) {
      const conflict = await profileByFriendCode(ctx, newFriendCode);
      if (conflict) failProfile("INVALID_ARGUMENT", "Friend code is already in use.");
      const now = Date.now();
      await ctx.db.patch(profile._id, {
        friendCode: newFriendCode,
        friendCodeRotatedAt: now,
        updatedAt: now
      });
    }
    return { friendCode: newFriendCode, displayName: profile.displayName };
  }
});
