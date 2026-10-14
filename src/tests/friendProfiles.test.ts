import { beforeEach, describe, expect, it } from "vitest";
import {
  FOLLOWED_FRIENDS_KEY,
  FRIEND_PROFILE_KEY,
  createFriendCode,
  formatFriendCode,
  friendCodeFromHash,
  loadFollowedFriends,
  loadFriendProfile,
  normalizeFriendCode,
  saveFollowedFriends,
  saveFriendProfile,
  validFriendCode
} from "../session/friendProfiles";
import { parseFriendCode } from "../session/friendCode";
import { friendProfileErrorMessage, roomErrorMessage } from "../session/convexRoomTransport";
import {
  PROFILE_CREATION_LIMITED_MESSAGE,
  ROOM_CREATION_LIMITED_MESSAGE
} from "../session/creationLimits";

describe("device friend profiles", () => {
  beforeEach(() => localStorage.clear());

  it("creates high-entropy human-readable friend codes", () => {
    const friendCode = createFriendCode();
    expect(friendCode).toMatch(/^[2-9A-HJ-NP-Z]{20}$/);
    expect(validFriendCode(friendCode)).toBe(true);
    expect(formatFriendCode(friendCode).split("-")).toHaveLength(5);
  });

  it("accepts the same friend-code lengths as the server", () => {
    expect(validFriendCode("2345ABCDEFGHJKLMNPQ")).toBe(false);
    expect(validFriendCode("ABCDEFGHJKMNPQRSTVWXY234")).toBe(true);
    expect(validFriendCode("23456789ABCDEFGHJKLMNPQRSTUVWXYZ")).toBe(true);
    expect(normalizeFriendCode("23456789ABCDEFGHJKLMNPQRSTUVWXYZ2345")).toHaveLength(32);
    expect(parseFriendCode("abcd-efgh-jkmn-pqrs-tvwx-y234")).toBe("ABCDEFGHJKMNPQRSTVWXY234");
    expect(parseFriendCode("ABCDEFGHJKMNPQRSTVWXY23O")).toBeNull();
  });

  it("normalizes manual and QR friend codes", () => {
    const compact = "2345ABCDEFGHJKLMNPQR";
    expect(normalizeFriendCode("2345-abcd efgh-jklm-npqr")).toBe(compact);
    expect(friendCodeFromHash("#/friend/2345-ABCD-EFGH-JKLM-NPQR")).toBe(compact);
  });

  it("persists the private device profile and deduplicated follows", () => {
    const profile = {
      schemaVersion: 1 as const,
      friendCode: "2345ABCDEFGHJKLMNPQR",
      displayName: "Alex",
      ownerSecret: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG"
    };
    expect(saveFriendProfile(profile)).toBe(true);
    expect(loadFriendProfile()).toEqual(profile);

    const friend = {
      schemaVersion: 1 as const,
      friendCode: "9876ZYXWVUTSRQPNMLKJ",
      displayName: "Blair"
    };
    localStorage.setItem(FOLLOWED_FRIENDS_KEY, JSON.stringify([friend, friend]));
    expect(loadFollowedFriends()).toEqual([friend]);
    expect(saveFollowedFriends([friend])).toBe(true);
    expect(JSON.parse(localStorage.getItem(FRIEND_PROFILE_KEY) ?? "null")).toEqual(profile);
  });
});

describe("creation limit errors", () => {
  function limited(message?: string) {
    return Object.assign(new Error("[CONVEX M(friendProfiles:create)] Uncaught ConvexError"), {
      data: { code: "RATE_LIMITED", ...(message ? { message } : {}) }
    });
  }

  it("shows the server's generic limit message instead of raw Convex errors", () => {
    expect(friendProfileErrorMessage(limited(PROFILE_CREATION_LIMITED_MESSAGE), "Failed."))
      .toBe(PROFILE_CREATION_LIMITED_MESSAGE);
    expect(roomErrorMessage(limited(ROOM_CREATION_LIMITED_MESSAGE)))
      .toBe(ROOM_CREATION_LIMITED_MESSAGE);
    expect(roomErrorMessage(limited())).toBe(ROOM_CREATION_LIMITED_MESSAGE);
    expect(friendProfileErrorMessage(limited(), "Failed.")).toBe("Failed.");
  });

  it("keeps local device errors readable", () => {
    expect(friendProfileErrorMessage(new Error("Could not save on this device."), "Failed."))
      .toBe("Could not save on this device.");
  });
});
