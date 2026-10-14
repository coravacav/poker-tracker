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
