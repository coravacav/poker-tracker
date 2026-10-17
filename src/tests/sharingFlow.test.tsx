import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import type { GameState } from "../domain/pokerTypes";
import { gameReducer } from "../state/gameReducer";
import { STORAGE_KEY } from "../state/persistence";
import { LAST_VISIT_KEY } from "../session/localEntry";
import {
  GUEST_SESSION_KEY,
  saveHostRecovery,
  saveRoomHistoryCredential
} from "../session/sessionPersistence";
import { createDefaultGameState } from "../state/seedGame";
import type {
  GuestRoomProjection,
  HostRoomProjection,
  RoomProjection,
  RoomTransport
} from "../session/types";

function renderGameApp(transport: RoomTransport) {
  const result = render(<App roomTransport={transport} />);
  const continueButton = screen.queryByRole("button", { name: /^Continue / });
  const startButton = screen.queryByRole("button", { name: "Start new game" });
  if (continueButton || startButton) fireEvent.click(continueButton ?? startButton!);
  const playButton = screen.queryByRole("button", { name: "Play" });
  if (playButton && playButton.getAttribute("aria-pressed") !== "true") fireEvent.click(playButton);
  return result;
}

function projection(state: GameState): RoomProjection {
  return {
    publicId: "room_public_123456",
    status: "active",
    name: state.settings.gameName,
    state,
    version: 0,
    endedAt: null
  };
}

function fakeTransport(state = createDefaultGameState()) {
  let room = projection(state);
  let hostListener: ((value: HostRoomProjection) => void) | null = null;
  let hostError: ((error: Error) => void) | null = null;
  let guestListener: ((value: GuestRoomProjection) => void) | null = null;
  let connectionListener: ((connected: boolean) => void) | null = null;
  let connected = true;
  const createRoom = vi.fn(async (_args: Parameters<RoomTransport["createRoom"]>[0]) => room);
  const heartbeat = vi.fn(async () => undefined);
  const endRoom = vi.fn(async (_args: Parameters<RoomTransport["endRoom"]>[0]) => ({
    ...room,
    status: "ended" as const,
    endedAt: Date.now()
  }));
  const transport: RoomTransport = {
    configured: true,
    connectionState: () => connected,
    subscribeToConnection(listener) {
      connectionListener = listener;
      listener(connected);
      return () => {
        connectionListener = null;
      };
    },
    createRoom,
    getInvitePreview: vi.fn(async () => ({ status: "active" as const, name: room.name })),
    joinRoom: vi.fn(async ({ displayName }) => ({ ...room, displayName })),
    subscribeHost(_args, onUpdate, onError) {
      hostListener = onUpdate;
      hostError = onError;
      return () => {
        hostListener = null;
        hostError = null;
      };
    },
    subscribeGuest(_args, onUpdate) {
      guestListener = onUpdate;
      return () => {
        guestListener = null;
      };
    },
    heartbeat,
    submitGuestTransaction: vi.fn(async () => "request_test" as never),
    decideGuestTransaction: vi.fn(async () => undefined),
    setJoiningOpen: vi.fn(async () => undefined),
    rotateInvite: vi.fn(async () => undefined),
    revokeGuest: vi.fn(async () => undefined),
    getRoomHistory: vi.fn(async () => []),
    applyAction: vi.fn(async ({ action }) => {
      room = {
        ...room,
        state: gameReducer(room.state, action),
        version: room.version + 1
      };
      return { ...room, duplicate: false, resultingVersion: room.version };
    }),
    acknowledgeHostNotifications: vi.fn(async () => undefined),
    acknowledgeGuestNotifications: vi.fn(async () => undefined),
    claimHost: vi.fn(async () => undefined),
    endRoom
  };
  return {
    transport,
    createRoom,
    endRoom,
    heartbeat,
    emitHost(value: HostRoomProjection) {
      hostListener?.(value);
    },
    emitHostError(error: Error) {
      hostError?.(error);
    },
    emitGuest(value: GuestRoomProjection) {
      guestListener?.(value);
    },
    setConnected(value: boolean) {
      connected = value;
      connectionListener?.(value);
    },
    setRoom(value: RoomProjection) {
      room = value;
    }
  };
}

describe("realtime sharing UI", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(LAST_VISIT_KEY, String(Date.now()));
    sessionStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  it("creates a host room and never puts host authority in the invitation", async () => {
    const fake = fakeTransport();
    renderGameApp(fake.transport);
    expect(screen.getByRole("heading", { level: 1, name: "Poker Tracker" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Share game" }));
    const dialog = await screen.findByRole("dialog", { name: "Share game" });
    expect(dialog).toBeInTheDocument();
    // Once shared, the header names the game.
    expect(screen.getByRole("heading", { level: 1, name: "Poker Night" })).toBeInTheDocument();
    const createArgs = fake.createRoom.mock.calls[0]![0];
    const invite = screen.getByRole("textbox", { name: "Invite link" });
    expect((invite as HTMLInputElement).value).toContain("#/join/");
    expect((invite as HTMLInputElement).value).not.toContain(createArgs.hostSecret);
    expect((invite as HTMLInputElement).value).toContain(createArgs.inviteSecret);
  });

  it("shows a generic message when sharing is unavailable", async () => {
    const fake = fakeTransport();
    fake.transport.configured = false;
    renderGameApp(fake.transport);

    fireEvent.click(screen.getByRole("button", { name: "Share game" }));

    expect(
      await screen.findByText("Game sharing is unavailable right now. Please try again later.")
    ).toBeInTheDocument();
    expect(screen.queryByText(/VITE_|Convex|configured/i)).not.toBeInTheDocument();
  });

  it("keeps playing locally when room creation is rate limited", async () => {
    const local = createDefaultGameState();
    local.settings.gameName = "Local only night";
    localStorage.setItem(STORAGE_KEY, JSON.stringify(local));
    const fake = fakeTransport();
    fake.createRoom.mockRejectedValueOnce(
      Object.assign(new Error("[CONVEX M(rooms:create)] Uncaught ConvexError"), {
        data: {
          code: "RATE_LIMITED",
          message: "Too many new shared rooms right now. Try again in a few minutes."
        }
      })
    );
    renderGameApp(fake.transport);

    fireEvent.click(screen.getByRole("button", { name: "Share game" }));

    expect(
      await screen.findByText("Too many new shared rooms right now. Try again in a few minutes.")
    ).toBeInTheDocument();
    expect(screen.queryByText(/CONVEX|rooms:create/)).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Share game" })).not.toBeInTheDocument();
    expect(localStorage.getItem("poker-tracker:v1:hosted-room")).toBeNull();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null")).toMatchObject({
      localGameId: local.localGameId,
      settings: { gameName: "Local only night" }
    });

    // Sharing can be retried once the limit clears.
    fireEvent.click(screen.getByRole("button", { name: "Share game" }));
    expect(await screen.findByRole("dialog", { name: "Share game" })).toBeInTheDocument();
    expect(fake.createRoom).toHaveBeenCalledTimes(2);
  });

  it("moves a missing host room into recoverable local mode", async () => {
    const local = createDefaultGameState();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(local));
    saveHostRecovery({
      schemaVersion: 1,
      publicId: "room_public_123456",
      localGameId: local.localGameId,
      hostSecret: "host_abcdefghijklmnopqrstuvwxyz0123456789",
      inviteSecret: "invite_abcdefghijklmnopqrstuvwxyz0123456789",
      inviteUrl: "https://example.test/#/join/room_public_123456/invite",
      roomName: "Poker Night",
      lastKnownVersion: 4
    });
    const fake = fakeTransport(local);

    renderGameApp(fake.transport);
    expect(await screen.findByText("Restoring the shared room…")).toBeInTheDocument();

    const accepted = {
      ...local,
      settings: { ...local.settings, gameName: "Accepted remote state" }
    };
    act(() => {
      fake.emitHost({
        ...projection(accepted),
        guestCount: 0,
        guestRequests: [],
        joiningOpen: true,
        guests: [],
        controllerStatus: "active"
      });
    });

    act(() => {
      fake.emitHostError(
        Object.assign(new Error("Shared room was not found."), {
          data: { code: "ROOM_NOT_FOUND", message: "Shared room was not found." }
        })
      );
    });

    expect(await screen.findByText("Shared room unavailable.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share unavailable" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create new share" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Guest invitation QR code")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop sharing" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Continue locally" }));
    expect(await screen.findByRole("button", { name: "Share game" })).toBeInTheDocument();
    expect(localStorage.getItem("poker-tracker:v1:hosted-room")).toBeNull();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null")).toMatchObject({
      localGameId: local.localGameId,
      settings: { gameName: "Accepted remote state" }
    });
  });

  it("can retry a missing room and resume sharing when it returns", async () => {
    const local = createDefaultGameState();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(local));
    saveHostRecovery({
      schemaVersion: 1,
      publicId: "room_public_123456",
      localGameId: local.localGameId,
      hostSecret: "host_abcdefghijklmnopqrstuvwxyz0123456789",
      inviteSecret: "invite_abcdefghijklmnopqrstuvwxyz0123456789",
      inviteUrl: "https://example.test/#/join/room_public_123456/invite",
      roomName: "Poker Night",
      lastKnownVersion: 4
    });
    const fake = fakeTransport(local);
    renderGameApp(fake.transport);
    await screen.findByText("Restoring the shared room…");
    act(() => fake.emitHostError(new Error("Shared room was not found.")));
    await screen.findByText("Shared room unavailable.");

    fireEvent.click(screen.getByRole("button", { name: "Retry room" }));
    await screen.findByText("Restoring the shared room…");
    act(() => {
      fake.emitHost({
        ...projection(local),
        guestCount: 0,
        guestRequests: [],
        joiningOpen: true,
        guests: [],
        controllerStatus: "active"
      });
    });

    expect(await screen.findByRole("button", { name: "Sharing live" })).toBeInTheDocument();
    expect(screen.getByLabelText("Guest invitation QR code")).toBeInTheDocument();
  });

  it("joins as a named read-only guest without overwriting the local game", async () => {
    const local = createDefaultGameState();
    local.settings.gameName = "Local game";
    localStorage.setItem(STORAGE_KEY, JSON.stringify(local));
    const remote = createDefaultGameState();
    remote.settings.gameName = "Remote table";
    const fake = fakeTransport(remote);
    window.history.replaceState(
      null,
      "",
      "/#/join/room_public_123456/invite_abcdefghijklmnopqrstuvwxyz0123456789"
    );

    renderGameApp(fake.transport);
    expect(await screen.findByRole("heading", { name: "Remote table" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Display name" }), {
      target: { value: "Observer" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Join game" }));

    await screen.findByText("Viewing as Observer");
    // The header names the room's game rather than the app.
    expect(screen.getByRole("heading", { level: 1, name: "Remote table" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settle" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Setup" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add transaction" })).not.toBeInTheDocument();
    expect(screen.queryByTitle("Rename player")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Transaction Audit" })).toBeInTheDocument();
    // A guest's entry is a request, and its drawer says so.
    fireEvent.click(screen.getByRole("button", { name: "Request transaction" }));
    const request = screen.getByRole("dialog", { name: "Request transaction" });
    expect(within(request).getByRole("heading", { name: "Request Transaction" })).toBeInTheDocument();
    expect(within(request).getByRole("button", { name: "Send to host" })).toBeInTheDocument();
    expect(within(request).queryByRole("heading", { name: "Add Transaction" })).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null").settings.gameName).toBe(
      "Local game"
    );
  });

  it("returns a guest without a local game to Home, not an empty table", async () => {
    const remote = createDefaultGameState();
    remote.settings.gameName = "Remote table";
    const fake = fakeTransport(remote);
    window.history.replaceState(
      null,
      "",
      "/#/join/room_public_123456/invite_abcdefghijklmnopqrstuvwxyz0123456789"
    );

    renderGameApp(fake.transport);
    await screen.findByRole("heading", { name: "Remote table" });
    expect(screen.queryByRole("button", { name: "Return to local game" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Display name" }), {
      target: { value: "Observer" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Join game" }));
    await screen.findByText("Viewing as Observer");

    fireEvent.click(screen.getByRole("button", { name: "Leave" }));
    expect(await screen.findByRole("heading", { name: "Ready for poker night?" })).toBeInTheDocument();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("names where turning down an invitation goes", async () => {
    const fake = fakeTransport();
    const invite = "/#/join/room_public_123456/invite_abcdefghijklmnopqrstuvwxyz0123456789";
    window.history.replaceState(null, "", invite);
    const first = renderGameApp(fake.transport);
    fireEvent.click(await screen.findByRole("button", { name: "Back to Home" }));
    expect(await screen.findByRole("heading", { name: "Ready for poker night?" })).toBeInTheDocument();
    first.unmount();

    const local = createDefaultGameState();
    local.settings.gameName = "Local game";
    localStorage.setItem(STORAGE_KEY, JSON.stringify(local));
    window.history.replaceState(null, "", invite);
    renderGameApp(fake.transport);
    fireEvent.click(await screen.findByRole("button", { name: "Return to local game" }));
    // Straight back to the game, as before.
    expect(await screen.findByRole("button", { name: "Play" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { level: 1, name: "Poker Tracker" })).toBeInTheDocument();
  });

  it("restores a guest after tab storage is discarded", async () => {
    const remote = createDefaultGameState();
    remote.settings.gameName = "Recovered table";
    const fake = fakeTransport(remote);
    saveRoomHistoryCredential({
      schemaVersion: 1,
      publicId: "room_public_123456",
      role: "guest",
      secret: "guest_abcdefghijklmnopqrstuvwxyz0123456789",
      roomName: "Recovered table",
      joinedAt: Date.now(),
      displayName: "Observer"
    });
    window.history.replaceState(null, "", "/#/room/room_public_123456");

    renderGameApp(fake.transport);
    act(() => {
      fake.emitGuest({ ...projection(remote), displayName: "Observer" });
    });

    expect(await screen.findByText("Viewing as Observer")).toBeInTheDocument();
    expect(JSON.parse(sessionStorage.getItem(GUEST_SESSION_KEY) ?? "null")).toMatchObject({
      publicId: "room_public_123456",
      guestSecret: "guest_abcdefghijklmnopqrstuvwxyz0123456789",
      displayName: "Observer"
    });
  });

  it("renews guest presence immediately when the connection returns", async () => {
    const remote = createDefaultGameState();
    const fake = fakeTransport(remote);
    fake.setConnected(false);
    saveRoomHistoryCredential({
      schemaVersion: 1,
      publicId: "room_public_123456",
      role: "guest",
      secret: "guest_abcdefghijklmnopqrstuvwxyz0123456789",
      roomName: "Poker Night",
      joinedAt: Date.now(),
      displayName: "Observer"
    });
    window.history.replaceState(null, "", "/#/room/room_public_123456");

    renderGameApp(fake.transport);
    expect(fake.heartbeat).not.toHaveBeenCalled();

    act(() => fake.setConnected(true));

    await waitFor(() => expect(fake.heartbeat).toHaveBeenCalledTimes(1));
  });

  it("saves the confirmed final room state locally when sharing ends", async () => {
    const fake = fakeTransport();
    renderGameApp(fake.transport);
    fireEvent.click(screen.getByRole("button", { name: "Share game" }));
    await screen.findByRole("dialog", { name: "Share game" });

    const finalState = createDefaultGameState();
    const originalLocalId = fake.createRoom.mock.calls[0]![0].localGameId;
    finalState.localGameId = originalLocalId;
    finalState.settings.gameName = "Authoritative final";
    fake.endRoom.mockResolvedValueOnce({
      ...projection(finalState),
      status: "ended",
      endedAt: Date.now()
    });
    fireEvent.click(screen.getByRole("button", { name: "Stop sharing" }));

    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null").settings.gameName).toBe(
        "Authoritative final"
      )
    );
    expect(await screen.findByRole("button", { name: "Share game" })).toBeInTheDocument();
  });

  it("keeps recovery metadata and reports recovery when final confirmation fails", async () => {
    const fake = fakeTransport();
    fake.endRoom.mockRejectedValueOnce(new Error("network unavailable"));
    renderGameApp(fake.transport);
    fireEvent.click(screen.getByRole("button", { name: "Share game" }));
    await screen.findByRole("dialog", { name: "Share game" });
    fireEvent.click(screen.getByRole("button", { name: "Stop sharing" }));

    expect(await screen.findByRole("button", { name: "Retry final sync" })).toBeInTheDocument();
    expect(localStorage.getItem("poker-tracker:v1:hosted-room")).not.toBeNull();
  });

  describe("room actions resolving after newer room updates", () => {
    const hostRecovery = (localGameId: string) => ({
      schemaVersion: 1 as const,
      publicId: "room_public_123456",
      localGameId,
      hostSecret: "host_abcdefghijklmnopqrstuvwxyz0123456789",
      inviteSecret: "invite_abcdefghijklmnopqrstuvwxyz0123456789",
      inviteUrl: "https://example.test/#/join/room_public_123456/invite_abcdefghijklmnopqrstuvwxyz0123456789",
      roomName: "Poker Night",
      lastKnownVersion: 0
    });
    const hostProjection = (
      state: GameState,
      controllerStatus: HostRoomProjection["controllerStatus"],
      version = 0
    ): HostRoomProjection => ({
      ...projection(state),
      version,
      guestCount: 0,
      guestRequests: [],
      joiningOpen: true,
      guests: [],
      controllerStatus
    });

    it("hands control to this tab as soon as a takeover succeeds", async () => {
      // Tab B reopens a room that tab A currently controls.
      const local = createDefaultGameState();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(local));
      saveHostRecovery(hostRecovery(local.localGameId));
      const fake = fakeTransport(local);
      // Like Convex, the subscription sees the new controller before the
      // mutation promise resolves.
      fake.transport.claimHost = vi.fn(async () => {
        fake.emitHost(hostProjection(local, "active", 1));
      });
      renderGameApp(fake.transport);
      act(() => fake.emitHost(hostProjection(local, "duplicate")));

      fireEvent.click(await screen.findByRole("button", { name: "Take control here" }));

      await waitFor(() =>
        expect(screen.queryByText("Another tab currently controls this room.")).not.toBeInTheDocument()
      );
      expect(fake.transport.claimHost).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("button", { name: "Take control here" })).not.toBeInTheDocument();
    });

    it("keeps a rotated invite when the room updates afterwards", async () => {
      const local = createDefaultGameState();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(local));
      saveHostRecovery(hostRecovery(local.localGameId));
      const fake = fakeTransport(local);
      renderGameApp(fake.transport);
      act(() => fake.emitHost(hostProjection(local, "active")));

      fireEvent.click(await screen.findByRole("button", { name: /Rotate invite/ }));
      await waitFor(() => expect(fake.transport.rotateInvite).toHaveBeenCalledTimes(1));
      const { inviteSecret } = vi.mocked(fake.transport.rotateInvite).mock.calls[0]![0];
      const invite = () => (screen.getByRole("textbox", { name: "Invite link" }) as HTMLInputElement).value;
      await waitFor(() => expect(invite()).toContain(inviteSecret));

      act(() => fake.emitHost(hostProjection(local, "active", 1)));

      expect(invite()).toContain(inviteSecret);
      expect(
        JSON.parse(localStorage.getItem("poker-tracker:v1:hosted-room") ?? "null")
      ).toMatchObject({ inviteSecret, lastKnownVersion: 1 });
    });

    it("reuses the ending action id after a room update during a failed end", async () => {
      const local = createDefaultGameState();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(local));
      saveHostRecovery(hostRecovery(local.localGameId));
      const fake = fakeTransport(local);
      fake.endRoom.mockImplementationOnce(async () => {
        fake.emitHost(hostProjection(local, "active", 1));
        throw new Error("network unavailable");
      });
      renderGameApp(fake.transport);
      act(() => fake.emitHost(hostProjection(local, "active")));

      fireEvent.click(await screen.findByRole("button", { name: "Stop sharing" }));
      const retry = await screen.findByRole("button", { name: "Retry final sync" });
      // The id must survive a reload too, so the stored record keeps it.
      expect(
        JSON.parse(localStorage.getItem("poker-tracker:v1:hosted-room") ?? "null").endingActionId
      ).toBe(fake.endRoom.mock.calls[0]![0].clientActionId);
      fireEvent.click(retry);

      await waitFor(() => expect(fake.endRoom).toHaveBeenCalledTimes(2));
      const [first, second] = fake.endRoom.mock.calls.map(([args]) => args.clientActionId);
      expect(second).toBe(first);
    });
  });
});
