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

function parseStored(key: string): unknown {
  if (typeof localStorage === "undefined") return null;
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

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

export function loadFriendProfile(): FriendProfile | null {
  const value = parseStored(FRIEND_PROFILE_KEY);
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
  const value = parseStored(FOLLOWED_FRIENDS_KEY);
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((entry): FollowedFriend[] => {
    if (!entry || typeof entry !== "object") return [];
    const candidate = entry as Partial<FollowedFriend>;
    if (
      candidate.schemaVersion !== 1 ||
      typeof candidate.friendCode !== "string" ||
      !validFriendCode(candidate.friendCode) ||
      typeof candidate.displayName !== "string"
    ) return [];
    const friendCode = normalizeFriendCode(candidate.friendCode);
    if (seen.has(friendCode)) return [];
    seen.add(friendCode);
    return [{
      schemaVersion: 1,
      friendCode,
      displayName: candidate.displayName.trim() || "Poker friend"
    }];
  }).slice(0, 50);
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
