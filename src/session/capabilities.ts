export type InviteRoute =
  | { kind: "invite"; publicId: string; inviteSecret: string }
  | { kind: "guest_room"; publicId: string }
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

export function parseInviteRoute(hash = window.location.hash): InviteRoute {
  const inviteMatch = hash.match(/^#\/join\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)$/);
  if (inviteMatch) {
    return { kind: "invite", publicId: inviteMatch[1], inviteSecret: inviteMatch[2] };
  }
  const roomMatch = hash.match(/^#\/room\/([A-Za-z0-9_-]+)$/);
  if (roomMatch) return { kind: "guest_room", publicId: roomMatch[1] };
  return { kind: "none" };
}

export function guestRoomHash(publicId: string): string {
  return `#/room/${publicId}`;
}
