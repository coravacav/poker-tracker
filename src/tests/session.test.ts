import { beforeEach, describe, expect, it } from "vitest";
import { createInviteUrl, parseInviteRoute } from "../session/capabilities";
import {
  GUEST_SESSION_KEY,
  HOST_RECOVERY_KEY,
  loadGuestSession,
  loadHostRecovery,
  saveGuestSession,
  saveHostRecovery
} from "../session/sessionPersistence";

describe("shared session isolation", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("builds a fragment invitation without host authority", () => {
    const invite = createInviteUrl("room_public_123456", "guest_invite_123456789012345678901234", {
      origin: "https://poker.stefanbt.com",
      pathname: "/"
    });
    expect(invite).toBe(
      "https://poker.stefanbt.com/#/join/room_public_123456/guest_invite_123456789012345678901234"
    );
    expect(invite).not.toContain("host-secret");
    expect(parseInviteRoute(new URL(invite).hash)).toEqual({
      kind: "invite",
      publicId: "room_public_123456",
      inviteSecret: "guest_invite_123456789012345678901234"
    });
  });

  it("keeps host recovery local and guest credentials tab-scoped without game state", () => {
    saveHostRecovery({
      schemaVersion: 1,
      publicId: "room_public_123456",
      localGameId: "game_local_123456",
      hostSecret: "host-secret",
      inviteSecret: "invite-secret",
      inviteUrl: "https://example.test/#/join/room/invite",
      roomName: "Poker Night",
      lastKnownVersion: 3
    });
    saveGuestSession({
      schemaVersion: 1,
      publicId: "room_public_123456",
      guestSecret: "guest-secret",
      presenceSessionId: "presence-session",
      displayName: "Guest"
    });

    expect(loadHostRecovery()?.lastKnownVersion).toBe(3);
    expect(loadGuestSession("room_public_123456")?.displayName).toBe("Guest");
    expect(localStorage.getItem(GUEST_SESSION_KEY)).toBeNull();
    expect(sessionStorage.getItem(HOST_RECOVERY_KEY)).toBeNull();
    expect(sessionStorage.getItem(GUEST_SESSION_KEY)).not.toContain("transactions");
  });
});
