import { beforeEach, describe, expect, it } from "vitest";
import { createInviteUrl, createWatchUrl, parseInviteRoute } from "../session/capabilities";
import {
  GUEST_SESSION_KEY,
  HOST_RECOVERY_KEY,
  loadGuestSession,
  loadHostRecovery,
  loadRoomHistoryCredentials,
  recoverGuestSession,
  saveGuestSession,
  saveHostRecovery,
  saveRoomHistoryCredential,
  watchPresenceSessionId
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

  it("builds and reads a watch link apart from the invitation", () => {
    const watch = createWatchUrl("room_public_123456", "watch_secret_123456789012345678901234", {
      origin: "https://poker.stefanbt.com",
      pathname: "/"
    });
    expect(watch).toBe(
      "https://poker.stefanbt.com/#/watch/room_public_123456/watch_secret_123456789012345678901234"
    );
    expect(parseInviteRoute(new URL(watch).hash)).toEqual({
      kind: "watch",
      publicId: "room_public_123456",
      spectatorSecret: "watch_secret_123456789012345678901234"
    });
    expect(parseInviteRoute("#/watch/room_public_123456")).toEqual({ kind: "none" });
    expect(parseInviteRoute("#/watch/room_public_123456/secret/extra")).toEqual({ kind: "none" });
    expect(parseInviteRoute("#/watch/room public/secret")).toEqual({ kind: "none" });
  });

  it("keeps the watch link's secret in host recovery across reloads", () => {
    const recovery = {
      schemaVersion: 1 as const,
      publicId: "room_public_123456",
      localGameId: "game_local_123456",
      hostSecret: "host-secret",
      inviteSecret: "invite-secret",
      inviteUrl: "https://example.test/#/join/room/invite",
      roomName: "Poker Night",
      lastKnownVersion: 3
    };
    saveHostRecovery({ ...recovery, spectatorSecret: "watch-secret" });
    expect(loadHostRecovery()).toEqual({ ...recovery, spectatorSecret: "watch-secret" });

    // Without a watch link the record round-trips as before.
    saveHostRecovery(recovery);
    expect(loadHostRecovery()).toEqual(recovery);

    // An unusable watch secret turns the link off here; the host secret survives.
    localStorage.setItem(HOST_RECOVERY_KEY, JSON.stringify({ ...recovery, spectatorSecret: 42 }));
    expect(loadHostRecovery()).toEqual(recovery);
  });

  it("keeps one watcher presence id per tab and room", () => {
    let next = 0;
    const createId = () => `presence_${(next += 1)}_abcdefghijkl`;
    const first = watchPresenceSessionId("room_public_123456", createId);
    expect(watchPresenceSessionId("room_public_123456", createId)).toBe(first);
    expect(watchPresenceSessionId("room_public_other12", createId)).not.toBe(first);
    expect(localStorage.length).toBe(0);
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

  it("retains room participation credentials for history", () => {
    saveRoomHistoryCredential({
      schemaVersion: 1,
      publicId: "room_public_123456",
      role: "guest",
      secret: "guest-secret",
      roomName: "Poker Night",
      joinedAt: 123,
      displayName: "Guest"
    });
    expect(loadRoomHistoryCredentials()).toEqual([
      expect.objectContaining({ publicId: "room_public_123456", role: "guest" })
    ]);
  });

  it("recovers a tab-scoped guest session from durable room history", () => {
    saveRoomHistoryCredential({
      schemaVersion: 1,
      publicId: "room_public_123456",
      role: "guest",
      secret: "guest-secret",
      roomName: "Poker Night",
      joinedAt: 123,
      displayName: "Guest",
      deploymentUrl: "https://example.convex.cloud"
    });

    expect(
      recoverGuestSession(
        "room_public_123456",
        "new-presence-session",
        "https://example.convex.cloud"
      )
    ).toEqual({
      schemaVersion: 1,
      publicId: "room_public_123456",
      guestSecret: "guest-secret",
      presenceSessionId: "new-presence-session",
      displayName: "Guest"
    });
    expect(loadGuestSession("room_public_123456")?.presenceSessionId).toBe(
      "new-presence-session"
    );
  });

  it("does not recover a guest credential from another deployment", () => {
    saveRoomHistoryCredential({
      schemaVersion: 1,
      publicId: "room_public_123456",
      role: "guest",
      secret: "guest-secret",
      roomName: "Poker Night",
      joinedAt: 123,
      displayName: "Guest",
      deploymentUrl: "https://old.convex.cloud"
    });

    expect(
      recoverGuestSession(
        "room_public_123456",
        "new-presence-session",
        "https://new.convex.cloud"
      )
    ).toBeNull();
  });
});
