import {
  quarantineEntries,
  quarantineRaw,
  readStoredJson,
  reasonForInvalid
} from "../state/storageQuarantine";

export const FRIEND_PROFILE_KEY = "poker-tracker:v1:friend-profile";
export const FOLLOWED_FRIENDS_KEY = "poker-tracker:v1:followed-friends";

const FRIEND_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const FRIEND_CODE_PATTERN = /^[2-9A-HJ-NP-Z]{20}$/;

export type FriendProfile = {
  schemaVersion: 1;
  friendCode: string;
  displayName: string;
  ownerSecret: string;
};

export type FollowedFriend = {
  schemaVersion: 1;
  friendCode: string;
  displayName: string;
};

const FRIEND_SCHEMA_VERSION = 1;

export function normalizeFriendCode(value: string): string {
  return value.toUpperCase().replace(/[^2-9A-HJ-NP-Z]/g, "").slice(0, 20);
}

export function formatFriendCode(value: string): string {
  return normalizeFriendCode(value).match(/.{1,4}/g)?.join("-") ?? "";
}

export function validFriendCode(value: string): boolean {
  return FRIEND_CODE_PATTERN.test(normalizeFriendCode(value));
}

export function createFriendCode(): string {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("Secure random friend-code generation is unavailable in this browser.");
  }
  const bytes = new Uint8Array(20);
  globalThis.crypto.getRandomValues(bytes);
  const compact = Array.from(
    bytes,
    (byte) => FRIEND_CODE_ALPHABET[byte % FRIEND_CODE_ALPHABET.length]
  ).join("");
  return normalizeFriendCode(compact);
}

export function friendCodeUrl(
  friendCode: string,
  location: Pick<Location, "origin" | "pathname"> = window.location
): string {
  return `${location.origin}${location.pathname}#/friend/${normalizeFriendCode(friendCode)}`;
}

export function friendCodeFromHash(hash = window.location.hash): string | null {
  const match = hash.match(/^#\/friend\/([2-9A-HJ-NP-Z-]+)$/i);
  if (!match) return null;
  const friendCode = normalizeFriendCode(match[1]);
  return validFriendCode(friendCode) ? friendCode : null;
}

function parseFriendProfile(value: unknown): FriendProfile | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<FriendProfile>;
  return candidate.schemaVersion === 1 &&
    typeof candidate.friendCode === "string" &&
    validFriendCode(candidate.friendCode) &&
    typeof candidate.displayName === "string" &&
    candidate.displayName.trim().length > 0 &&
    typeof candidate.ownerSecret === "string" &&
    candidate.ownerSecret.length >= 32
    ? {
        schemaVersion: 1,
        friendCode: normalizeFriendCode(candidate.friendCode),
        displayName: candidate.displayName.trim(),
        ownerSecret: candidate.ownerSecret
      }
    : null;
}

export function loadFriendProfile(): FriendProfile | null {
  const stored = readStoredJson(FRIEND_PROFILE_KEY);
  if (!stored) return null;
  const profile = parseFriendProfile(stored.value);
  // The owner secret cannot be recreated, so keep a copy before a new profile replaces it.
  if (!profile) {
    quarantineRaw(FRIEND_PROFILE_KEY, stored.raw, reasonForInvalid(stored.value, FRIEND_SCHEMA_VERSION));
  }
  return profile;
}

export function saveFriendProfile(profile: FriendProfile): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    localStorage.setItem(FRIEND_PROFILE_KEY, JSON.stringify(profile));
    return true;
  } catch {
    return false;
  }
}

export function loadFollowedFriends(): FollowedFriend[] {
  const stored = readStoredJson(FOLLOWED_FRIENDS_KEY);
  if (!stored) return [];
  const value = stored.value;
  if (!Array.isArray(value)) {
    quarantineRaw(FOLLOWED_FRIENDS_KEY, stored.raw, "invalid");
    return [];
  }
  const seen = new Set<string>();
  const skipped: unknown[] = [];
  const friends = value.flatMap((entry): FollowedFriend[] => {
    const candidate = (entry && typeof entry === "object" ? entry : {}) as Partial<FollowedFriend>;
    if (
      candidate.schemaVersion !== 1 ||
      typeof candidate.friendCode !== "string" ||
      !validFriendCode(candidate.friendCode) ||
      typeof candidate.displayName !== "string"
    ) {
      skipped.push(entry);
      return [];
    }
    const friendCode = normalizeFriendCode(candidate.friendCode);
    if (seen.has(friendCode)) return [];
    seen.add(friendCode);
    return [{
      schemaVersion: 1,
      friendCode,
      displayName: candidate.displayName.trim() || "Poker friend"
    }];
  }).slice(0, 50);
  quarantineEntries(FOLLOWED_FRIENDS_KEY, skipped, FRIEND_SCHEMA_VERSION);
  return friends;
}

export function saveFollowedFriends(friends: FollowedFriend[]): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    localStorage.setItem(FOLLOWED_FRIENDS_KEY, JSON.stringify(friends.slice(0, 50)));
    return true;
  } catch {
    return false;
  }
}
