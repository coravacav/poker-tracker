import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";

type ProfileErrorCode = "INVALID_ARGUMENT" | "INVALID_CAPABILITY" | "PROFILE_NOT_FOUND";

function failProfile(code: ProfileErrorCode, message: string): never {
  throw new ConvexError({ code, message });
}

function normalizeFriendCode(value: string): string {
  return value.trim().toUpperCase().replace(/[\s-]+/g, "");
}

function validFriendCode(value: string): boolean {
  return /^[2-9A-HJ-NP-Z]{20,32}$/.test(value);
}

function validProfileOwnerSecret(value: string): boolean {
  return /^[A-Za-z0-9_-]{32,256}$/.test(value);
}

function normalizeDisplayName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

async function hashProfileSecret(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function sameProfileHash(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

const publicProfileValidator = v.object({
  friendCode: v.string(),
  displayName: v.string()
});

const activityProfileValidator = publicProfileValidator.extend({
  room: v.union(
    v.null(),
    v.object({
      publicId: v.string(),
      name: v.string(),
      createdAt: v.number()
    })
  )
});

function validateDisplayName(value: string): string {
  const displayName = normalizeDisplayName(value);
  if (displayName.length < 1 || displayName.length > 40) {
    failProfile("INVALID_ARGUMENT", "Display name must be between 1 and 40 characters.");
  }
  return displayName;
}

function validateProfileCredentials(friendCodeValue: string, ownerSecret: string) {
  const friendCode = normalizeFriendCode(friendCodeValue);
  if (!validFriendCode(friendCode)) {
    failProfile("INVALID_ARGUMENT", "Friend code must contain 20 to 32 valid characters.");
  }
  if (!validProfileOwnerSecret(ownerSecret)) {
    failProfile("INVALID_ARGUMENT", "Profile owner capability is invalid.");
  }
  return friendCode;
}

async function requireProfileOwner(
  ctx: MutationCtx,
  friendCodeValue: string,
  ownerSecret: string
): Promise<Doc<"friendProfiles">> {
  const friendCode = validateProfileCredentials(friendCodeValue, ownerSecret);
  const profile = await ctx.db
    .query("friendProfiles")
    .withIndex("by_friend_code", (index) => index.eq("friendCode", friendCode))
    .unique();
  if (!profile) failProfile("PROFILE_NOT_FOUND", "Friend profile was not found.");
  const ownerSecretHash = await hashProfileSecret(ownerSecret);
  if (!sameProfileHash(profile.ownerSecretHash, ownerSecretHash)) {
    failProfile("INVALID_CAPABILITY", "Profile owner capability is invalid.");
  }
  return profile;
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
    const friendCode = validateProfileCredentials(args.friendCode, args.ownerSecret);
    const displayName = validateDisplayName(args.displayName);
    const ownerSecretHash = await hashProfileSecret(args.ownerSecret);
    const existing = await ctx.db
      .query("friendProfiles")
      .withIndex("by_friend_code", (index) => index.eq("friendCode", friendCode))
      .unique();
    const now = Date.now();
    if (existing) {
      if (!sameProfileHash(existing.ownerSecretHash, ownerSecretHash)) {
        failProfile("INVALID_CAPABILITY", "Friend code is already in use.");
      }
      if (existing.displayName !== displayName) {
        await ctx.db.patch(existing._id, { displayName, updatedAt: now });
      }
      return { friendCode, displayName };
    }

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
    const friendCode = normalizeFriendCode(args.friendCode);
    if (!validFriendCode(friendCode)) return null;
    const profile = await ctx.db
      .query("friendProfiles")
      .withIndex("by_friend_code", (index) => index.eq("friendCode", friendCode))
      .unique();
    return profile ? { friendCode: profile.friendCode, displayName: profile.displayName } : null;
  }
});

export const listActivity = query({
  args: { friendCodes: v.array(v.string()) },
  returns: v.array(activityProfileValidator),
  handler: async (ctx, args) => {
    if (args.friendCodes.length > 50) {
      failProfile("INVALID_ARGUMENT", "At most 50 friend codes can be checked at once.");
    }
    const friendCodes = [...new Set(
      args.friendCodes
        .map(normalizeFriendCode)
        .filter(validFriendCode)
    )];
    const profiles = await Promise.all(friendCodes.map((friendCode) =>
      ctx.db
        .query("friendProfiles")
        .withIndex("by_friend_code", (index) => index.eq("friendCode", friendCode))
        .unique()
    ));

    return await Promise.all(profiles.flatMap((profile) => profile ? [profile] : []).map(async (profile) => {
      const room = profile.activeRoomId ? await ctx.db.get("rooms", profile.activeRoomId) : null;
      const discoverable = room &&
        room.status === "active" &&
        room.hostProfileId === profile._id &&
        room.visibleToFriends === true;
      return {
        friendCode: profile.friendCode,
        displayName: profile.displayName,
        room: discoverable ? {
          publicId: room.publicId,
          name: room.name,
          createdAt: room.createdAt
        } : null
      };
    }));
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

export const rotateCode = mutation({
  args: {
    friendCode: v.string(),
    ownerSecret: v.string(),
    newFriendCode: v.string()
  },
  returns: publicProfileValidator,
  handler: async (ctx, args) => {
    const profile = await requireProfileOwner(ctx, args.friendCode, args.ownerSecret);
    const newFriendCode = normalizeFriendCode(args.newFriendCode);
    if (!validFriendCode(newFriendCode)) {
      failProfile("INVALID_ARGUMENT", "Friend code must contain 20 to 32 valid characters.");
    }
    if (newFriendCode !== profile.friendCode) {
      const conflict = await ctx.db
        .query("friendProfiles")
        .withIndex("by_friend_code", (index) => index.eq("friendCode", newFriendCode))
        .unique();
      if (conflict) failProfile("INVALID_ARGUMENT", "Friend code is already in use.");
      await ctx.db.patch(profile._id, { friendCode: newFriendCode, updatedAt: Date.now() });
    }
    return { friendCode: newFriendCode, displayName: profile.displayName };
  }
});
