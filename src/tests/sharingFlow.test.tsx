import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import type { GameState } from "../domain/pokerTypes";
import { gameReducer } from "../state/gameReducer";
import { STORAGE_KEY } from "../state/persistence";
import { LAST_VISIT_KEY } from "../session/localEntry";
import { saveHostRecovery } from "../session/sessionPersistence";
import { createDefaultGameState } from "../state/seedGame";
import type {
  GuestRoomProjection,
  HostRoomProjection,
  RoomProjection,
  RoomTransport
} from "../session/types";

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
  const createRoom = vi.fn(async (_args: Parameters<RoomTransport["createRoom"]>[0]) => room);
  const endRoom = vi.fn(async (_args: Parameters<RoomTransport["endRoom"]>[0]) => ({
    ...room,
    status: "ended" as const,
    endedAt: Date.now()
  }));
  const transport: RoomTransport = {
    configured: true,
    connectionState: () => true,
    subscribeToConnection(listener) {
      listener(true);
      return () => undefined;
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
    heartbeat: vi.fn(async () => undefined),
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
    emitHost(value: HostRoomProjection) {
      hostListener?.(value);
    },
    emitHostError(error: Error) {
      hostError?.(error);
    },
    emitGuest(value: GuestRoomProjection) {
      guestListener?.(value);
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
    render(<App roomTransport={fake.transport} />);

    fireEvent.click(screen.getByRole("button", { name: "Share game" }));
    const dialog = await screen.findByRole("dialog", { name: "Share game" });
    expect(dialog).toBeInTheDocument();
    const createArgs = fake.createRoom.mock.calls[0]![0];
    const invite = screen.getByRole("textbox", { name: "Invite link" });
    expect((invite as HTMLInputElement).value).toContain("#/join/");
    expect((invite as HTMLInputElement).value).not.toContain(createArgs.hostSecret);
    expect((invite as HTMLInputElement).value).toContain(createArgs.inviteSecret);
  });

  it("shows a generic message when sharing is unavailable", async () => {
    const fake = fakeTransport();
    fake.transport.configured = false;
    render(<App roomTransport={fake.transport} />);

    fireEvent.click(screen.getByRole("button", { name: "Share game" }));

    expect(
      await screen.findByText("Game sharing is unavailable right now. Please try again later.")
    ).toBeInTheDocument();
    expect(screen.queryByText(/VITE_|Convex|configured/i)).not.toBeInTheDocument();
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

    render(<App roomTransport={fake.transport} />);
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
    render(<App roomTransport={fake.transport} />);
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

    render(<App roomTransport={fake.transport} />);
    expect(await screen.findByRole("heading", { name: "Remote table" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Display name" }), {
      target: { value: "Observer" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Join game" }));

    await screen.findByText("Viewing as Observer");
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settle" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Setup" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add transaction" })).not.toBeInTheDocument();
    expect(screen.queryByTitle("Rename player")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Transaction Audit" })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null").settings.gameName).toBe(
      "Local game"
    );
  });

  it("saves the confirmed final room state locally when sharing ends", async () => {
    const fake = fakeTransport();
    render(<App roomTransport={fake.transport} />);
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
    render(<App roomTransport={fake.transport} />);
    fireEvent.click(screen.getByRole("button", { name: "Share game" }));
    await screen.findByRole("dialog", { name: "Share game" });
    fireEvent.click(screen.getByRole("button", { name: "Stop sharing" }));

    expect(await screen.findByRole("button", { name: "Retry final sync" })).toBeInTheDocument();
    expect(localStorage.getItem("poker-tracker:v1:hosted-room")).not.toBeNull();
  });
});
