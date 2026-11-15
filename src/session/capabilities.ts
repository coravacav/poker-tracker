export type InviteRoute =
  | { kind: "invite"; publicId: string; inviteSecret: string }
  | { kind: "guest_room"; publicId: string }
  | { kind: "watch"; publicId: string; spectatorSecret: string }
  | { kind: "host_phone"; publicId: string; linkSecret: string }
  | { kind: "none" };

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export function createCapability(byteLength = 32): string {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("Secure random capability generation is unavailable in this browser.");
  }
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export function createInviteUrl(
  publicId: string,
  inviteSecret: string,
  location: Pick<Location, "origin" | "pathname"> = window.location
): string {
  return `${location.origin}${location.pathname}#/join/${publicId}/${inviteSecret}`;
}

/** The read-only watch link; its secret is separate from the invitation's. */
export function createWatchUrl(
  publicId: string,
  spectatorSecret: string,
  location: Pick<Location, "origin" | "pathname"> = window.location
): string {
  return `${location.origin}${location.pathname}#/watch/${publicId}/${spectatorSecret}`;
}

/** The host's one-time link for their own phone, which seats it in the host's seat. */
export function createHostPhoneUrl(
  publicId: string,
  linkSecret: string,
  location: Pick<Location, "origin" | "pathname"> = window.location
): string {
  return `${location.origin}${location.pathname}#/phone/${publicId}/${linkSecret}`;
}

/**
 * The watch link's short id for a secret: the same SHA-256 prefix the host
 * view reports, so a host tab can tell whether its stored secret is current.
 */
export async function watchLinkIdForSecret(spectatorSecret: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(spectatorSecret));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

export function parseInviteRoute(hash = window.location.hash): InviteRoute {
  const inviteMatch = hash.match(/^#\/join\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)$/);
  if (inviteMatch) {
    return { kind: "invite", publicId: inviteMatch[1], inviteSecret: inviteMatch[2] };
  }
  const watchMatch = hash.match(/^#\/watch\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)$/);
  if (watchMatch) {
    return { kind: "watch", publicId: watchMatch[1], spectatorSecret: watchMatch[2] };
  }
  const phoneMatch = hash.match(/^#\/phone\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)$/);
  if (phoneMatch) {
    return { kind: "host_phone", publicId: phoneMatch[1], linkSecret: phoneMatch[2] };
  }
  const roomMatch = hash.match(/^#\/room\/([A-Za-z0-9_-]+)$/);
  if (roomMatch) return { kind: "guest_room", publicId: roomMatch[1] };
  return { kind: "none" };
}

export function guestRoomHash(publicId: string): string {
  return `#/room/${publicId}`;
}
