import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import type { GameState } from "../domain/pokerTypes";
import { gameReducer } from "../state/gameReducer";
import { STORAGE_KEY } from "../state/persistence";
import { LAST_VISIT_KEY } from "../session/localEntry";
import { watchLinkIdForSecret } from "../session/capabilities";
import {
  GUEST_SESSION_KEY,
  saveGuestSession,
  saveHostRecovery,
  saveRoomHistoryCredential
} from "../session/sessionPersistence";
import { createDefaultGameState } from "../state/seedGame";
import type {
  GuestRoomProjection,
  HostRoomProjection,
  RoomAgreement,
  RoomProjection,
  RoomTransport,
  SpectatorRoomProjection
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
  let spectatorListener: ((value: SpectatorRoomProjection) => void) | null = null;
  let spectatorError: ((error: Error) => void) | null = null;
  let connectionListener: ((connected: boolean) => void) | null = null;
  let connected = true;
  const createRoom = vi.fn(async (_args: Parameters<RoomTransport["createRoom"]>[0]) => room);
  const heartbeat = vi.fn(async () => undefined);
  const spectatorHeartbeat = vi.fn(async (_args: Parameters<NonNullable<RoomTransport["spectatorHeartbeat"]>>[0]) => undefined);
  const rotateSpectatorLink = vi.fn(async (_args: Parameters<NonNullable<RoomTransport["rotateSpectatorLink"]>>[0]) => undefined);
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
    subscribeSpectator(_args, onUpdate, onError) {
      spectatorListener = onUpdate;
      spectatorError = onError;
      return () => {
        spectatorListener = null;
        spectatorError = null;
      };
    },
    spectatorHeartbeat,
    rotateSpectatorLink,
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
    spectatorHeartbeat,
    rotateSpectatorLink,
    emitHost(value: HostRoomProjection) {
      hostListener?.(value);
    },
    emitHostError(error: Error) {
      hostError?.(error);
    },
    emitGuest(value: GuestRoomProjection) {
      guestListener?.(value);
    },
    emitSpectator(value: SpectatorRoomProjection) {
      spectatorListener?.(value);
    },
    emitSpectatorError(error: Error) {
      spectatorError?.(error);
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

  it("lists seats in the share dialog and sends the host's seat changes", async () => {
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
      lastKnownVersion: 0
    });
    const fake = fakeTransport(local);
    const releaseSeat = vi.fn(async (_args: Parameters<NonNullable<RoomTransport["releaseSeat"]>>[0]) => undefined);
    const assignSeat = vi.fn(async (_args: Parameters<NonNullable<RoomTransport["assignSeat"]>>[0]) => undefined);
    const setHostPlayer = vi.fn(async (_args: Parameters<NonNullable<RoomTransport["setHostPlayer"]>>[0]) => undefined);
    Object.assign(fake.transport, { releaseSeat, assignSeat, setHostPlayer });
    renderGameApp(fake.transport);
    const [first, second, third] = local.players;
    const guestId = "guest_maya" as never;
    act(() => fake.emitHost({
      ...projection(local),
      guestCount: 1,
      guestRequests: [],
      joiningOpen: true,
      guests: [],
      controllerStatus: "active",
      hostPlayerId: null,
      seats: local.players.map((player) => ({
        playerId: player.id,
        name: player.name,
        isHost: false,
        guest: player.id === second!.id ? { id: guestId, displayName: second!.name, connected: true } : null
      }))
    }));
    const dialog = await screen.findByRole("dialog", { name: "Share game" });
    const seats = within(dialog).getByRole("region", { name: "Seats" });
    expect(within(seats).getByText(`${second!.name}’s phone · online`)).toBeInTheDocument();

    fireEvent.change(within(seats).getByRole("combobox", { name: "Your seat" }), { target: { value: first!.id } });
    await waitFor(() => expect(setHostPlayer).toHaveBeenCalledWith(expect.objectContaining({
      publicId: "room_public_123456",
      hostSecret: "host_abcdefghijklmnopqrstuvwxyz0123456789",
      playerId: first!.id
    })));
    fireEvent.change(within(seats).getByRole("combobox", { name: `Move ${second!.name}’s phone` }), {
      target: { value: third!.id }
    });
    await waitFor(() => expect(assignSeat).toHaveBeenCalledWith(expect.objectContaining({ guestId, playerId: third!.id })));
    fireEvent.click(within(seats).getByRole("button", { name: `Release ${second!.name}’s seat` }));
    await waitFor(() =>
      expect(releaseSeat).toHaveBeenCalledWith(expect.objectContaining({ guestId, playerId: second!.id })));
  });

  it("counts waiting guest requests on the sharing button until the host decides", async () => {
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
      lastKnownVersion: 0
    });
    const fake = fakeTransport(local);
    renderGameApp(fake.transport);
    const host = (guestRequests: HostRoomProjection["guestRequests"]) => ({
      ...projection(local),
      guestCount: 1,
      guestRequests,
      joiningOpen: true,
      guests: [],
      controllerStatus: "active" as const
    });
    const request = (id: string) => ({
      id: id as never,
      displayName: "Riley",
      transaction: {
        id: `transaction_${id}`,
        type: "bank_buy_in" as const,
        createdAt: new Date(0).toISOString(),
        amountCents: 2000,
        toPlayerId: "player_1"
      },
      status: "pending" as const,
      createdAt: 0
    });
    act(() => fake.emitHost(host([request("request_a"), request("request_b")])));
    fireEvent.click(await screen.findByTitle("Close"));

    const button = screen.getByRole("button", { name: "Sharing live, 2 guest requests waiting" });
    expect(within(button).getByText("2")).toBeInTheDocument();

    act(() => fake.emitHost(host([request("request_b")])));
    expect(screen.getByRole("button", { name: "Sharing live, 1 guest request waiting" })).toBeInTheDocument();

    act(() => fake.emitHost(host([])));
    expect(screen.getByRole("button", { name: "Sharing live" })).toBeInTheDocument();
  });

  it("joins as a named read-only guest without overwriting the local game", async () => {
    const local = createDefaultGameState();
    local.settings.gameName = "Local game";
    localStorage.setItem(STORAGE_KEY, JSON.stringify(local));
    const remote = createDefaultGameState();
    remote.settings.gameName = "Remote table";
    remote.settings.chipDenominations = [
      { id: "chip_white", label: "White", colorHex: "#ffffff", valueCents: 25 },
      { id: "chip_red", label: "Red", colorHex: "#ff0000", valueCents: 100 }
    ];
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
    // Without Setup, the chip key shows on Play.
    const chipKey = screen.getByRole("region", { name: "Chip key" });
    expect(within(chipKey).getByText("White").closest("div")).toHaveTextContent("White$0.25");
    expect(within(chipKey).getByText("Red").closest("div")).toHaveTextContent("Red$1");
    // A guest's entry is a request, and its drawer says so.
    fireEvent.click(screen.getByRole("button", { name: "Request transaction" }));
    const request = screen.getByRole("dialog", { name: "Request transaction" });
    expect(within(request).getByRole("heading", { name: "Request Transaction" })).toBeInTheDocument();
    expect(within(request).getByText("Ask the host")).toBeInTheDocument();
    expect(within(request).getByRole("button", { name: "Send request" })).toBeInTheDocument();
    expect(within(request).queryByRole("heading", { name: "Add Transaction" })).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null").settings.gameName).toBe(
      "Local game"
    );
  });

  it("joins on a picked seat and plays as that player", async () => {
    const remote = createDefaultGameState();
    remote.settings.gameName = "Remote table";
    const [host, , maya] = remote.players;
    const fake = fakeTransport(remote);
    const seats = remote.players.map((player) => ({
      playerId: player.id,
      name: player.name,
      claimed: false,
      isHost: player.id === host.id
    }));
    fake.transport.getInvitePreview = vi.fn(async () => ({ status: "active" as const, name: "Remote table", seats }));
    const joinRoom = vi.fn(async (_args: Parameters<RoomTransport["joinRoom"]>[0]) => ({
      ...projection(remote),
      displayName: maya.name,
      seatPlayerId: maya.id,
      seats
    }));
    fake.transport.joinRoom = joinRoom;
    window.history.replaceState(
      null,
      "",
      "/#/join/room_public_123456/invite_abcdefghijklmnopqrstuvwxyz0123456789"
    );

    renderGameApp(fake.transport);
    expect(await screen.findByRole("heading", { name: "Who are you?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: new RegExp(`${host.name}.*Host`) })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(maya.name) }));
    fireEvent.click(screen.getByRole("button", { name: `Join as ${maya.name}` }));

    expect(await screen.findByText(`Playing as ${maya.name}`)).toBeInTheDocument();
    expect(joinRoom.mock.calls[0]![0]).toMatchObject({ playerId: maya.id });
    expect(joinRoom.mock.calls[0]![0]).not.toHaveProperty("displayName");
    // Seated, there is no seat prompt, and a request starts from the guest's own seat.
    expect(screen.queryByRole("button", { name: "Pick your seat" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Request transaction" }));
    const request = screen.getByRole("dialog", { name: "Request transaction" });
    expect(within(request).getByRole("combobox", { name: "To" })).toHaveValue(maya.id);
  });

  it("keeps the join screen's seats live", async () => {
    const remote = createDefaultGameState();
    const fake = fakeTransport(remote);
    let emitPreview: ((preview: Awaited<ReturnType<RoomTransport["getInvitePreview"]>>) => void) | null = null;
    fake.transport.subscribeInvitePreview = (_args, onUpdate) => {
      emitPreview = onUpdate;
      return () => {
        emitPreview = null;
      };
    };
    const seat = (name: string, claimed = false) => ({ playerId: `player_${name}`, name, claimed, isHost: false });
    window.history.replaceState(
      null,
      "",
      "/#/join/room_public_123456/invite_abcdefghijklmnopqrstuvwxyz0123456789"
    );

    renderGameApp(fake.transport);
    act(() => emitPreview?.({ status: "active", name: "Remote table", seats: [seat("Maya")] }));
    expect(await screen.findByRole("button", { name: /Maya/ })).toBeEnabled();
    act(() => emitPreview?.({ status: "active", name: "Remote table", seats: [seat("Maya", true), seat("Lena")] }));
    expect(screen.getByRole("button", { name: /Maya.*Joined on another phone/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Lena/ })).toBeEnabled();
  });

  it("asks a guest who joined without a seat to pick one on Play", async () => {
    const remote = createDefaultGameState();
    const fake = fakeTransport(remote);
    const seats = remote.players.map((player) => ({
      playerId: player.id,
      name: player.name,
      claimed: false,
      isHost: false
    }));
    const claimSeat = vi.fn(async (_args: Parameters<NonNullable<RoomTransport["claimSeat"]>>[0]) => undefined);
    fake.transport.claimSeat = claimSeat;
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
    act(() => fake.emitGuest({ ...projection(remote), displayName: "Observer", seatPlayerId: null, seats }));
    expect(await screen.findByText("Viewing as Observer")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pick your seat" }));
    const dialog = screen.getByRole("dialog", { name: "Pick your seat" });
    const seat = remote.players[1]!;
    fireEvent.click(within(dialog).getByRole("button", { name: new RegExp(seat.name) }));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: `I'm ${seat.name}` }));
    });
    expect(claimSeat.mock.calls[0]![0]).toMatchObject({ publicId: "room_public_123456", playerId: seat.id });

    act(() => fake.emitGuest({
      ...projection(remote),
      displayName: seat.name,
      seatPlayerId: seat.id,
      seats
    }));
    expect(await screen.findByText(`Playing as ${seat.name}`)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pick your seat" })).not.toBeInTheDocument();
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

  describe("watch link", () => {
    const watchHash = "/#/watch/room_public_123456/watch_abcdefghijklmnopqrstuvwxyz0123456789";
    const watchedState = () => {
      const state = createDefaultGameState();
      state.settings.gameName = "Friday Night Poker";
      state.settings.chipDenominations = [
        { id: "chip_white", label: "White", colorHex: "#ffffff", valueCents: 100 }
      ];
      return gameReducer(state, {
        type: "add_transaction",
        transaction: {
          id: "transaction_watch_1",
          type: "bank_buy_in",
          createdAt: new Date(0).toISOString(),
          amountCents: 2000,
          toPlayerId: state.players[0]!.id
        }
      });
    };
    const spectatorProjection = (
      state: GameState,
      extra: Partial<SpectatorRoomProjection> = {}
    ): SpectatorRoomProjection => ({
      ...projection(state),
      name: state.settings.gameName,
      version: 1,
      events: [
        {
          id: "event_buy_in",
          version: 1,
          actionType: "add_transaction",
          kind: "transaction",
          summary: "Player 1 bought in for $20.00",
          transactionIds: ["transaction_watch_1"],
          playerIds: [state.players[0]!.id],
          actorLabel: "Host",
          createdAt: Date.now(),
          notify: true
        },
        {
          id: "event_created",
          version: 0,
          actionType: "create_room",
          kind: "game",
          summary: "Created shared room",
          transactionIds: [],
          playerIds: [],
          actorLabel: "Host",
          createdAt: Date.now() - 1000,
          notify: false
        }
      ],
      ...extra
    });

    it("shows a live, read-only table with no name, requests, or Setup", async () => {
      const local = createDefaultGameState();
      local.settings.gameName = "My own game";
      localStorage.setItem(STORAGE_KEY, JSON.stringify(local));
      const fake = fakeTransport();
      window.history.replaceState(null, "", watchHash);
      render(<App roomTransport={fake.transport} />);

      expect(await screen.findByRole("heading", { name: "Opening the game…" })).toBeInTheDocument();
      expect(screen.queryByRole("textbox", { name: "Display name" })).not.toBeInTheDocument();
      act(() => fake.emitSpectator(spectatorProjection(watchedState())));

      expect(await screen.findByRole("heading", { level: 1, name: "Friday Night Poker" })).toBeInTheDocument();
      expect(screen.getByText("Spectating")).toBeInTheDocument();
      expect(within(screen.getByRole("region", { name: "Chip pool" })).getAllByRole("definition")[0]).toHaveTextContent("$20.00");
      expect(within(screen.getByRole("region", { name: "Chip key" })).getByText("White").closest("div")).toHaveTextContent("White$1");
      const feed = screen.getByRole("region", { name: "Live feed" });
      expect(within(feed).getByText("Player 1 bought in for $20.00")).toBeInTheDocument();
      expect(within(feed).queryByText("Created shared room")).not.toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Player 1" })).toBeInTheDocument();
      for (const name of [/Request transaction/, /Add transaction/, /^Setup$/, /^Settle$/, /Shared notifications/, /Undo/, /Record default buy-in/, /Transaction Audit/]) {
        expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
      }
      expect(screen.queryByTitle("Record default buy-in")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Results" })).not.toBeInTheDocument();
      await waitFor(() =>
        expect(fake.spectatorHeartbeat).toHaveBeenCalledWith({
          publicId: "room_public_123456",
          spectatorSecret: "watch_abcdefghijklmnopqrstuvwxyz0123456789",
          sessionId: expect.any(String)
        })
      );
      // Watching stores nothing about the room or a guest identity.
      expect(sessionStorage.getItem(GUEST_SESSION_KEY)).toBeNull();
      expect(localStorage.getItem("poker-tracker:v1:room-history")).toBeNull();
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null").settings.gameName).toBe("My own game");

      // The host ends the game: watchers land on the results.
      act(() =>
        fake.emitSpectator(spectatorProjection(watchedState(), { status: "ended", endedAt: Date.now() }))
      );
      expect(await screen.findByRole("heading", { name: "Settlement" })).toBeInTheDocument();
      expect(screen.getByText("The host ended this game.")).toBeInTheDocument();
      expect(screen.getByText("Game ended")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Table" }));
      expect(screen.getByRole("region", { name: "Live feed" })).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Leave" }));
      expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
      expect(window.location.hash).toBe("");
    });

    it("explains a turned-off watch link and leads Home", async () => {
      const fake = fakeTransport();
      window.history.replaceState(null, "", watchHash);
      render(<App roomTransport={fake.transport} />);
      act(() => fake.emitSpectator(spectatorProjection(watchedState())));
      await screen.findByText("Spectating");

      act(() =>
        fake.emitSpectatorError(
          Object.assign(new Error("[CONVEX Q(rooms:spectatorView)]"), {
            data: { code: "INVALID_CAPABILITY", message: "This watch link is invalid or turned off." }
          })
        )
      );
      expect(await screen.findByRole("heading", { name: "Watch link unavailable" })).toBeInTheDocument();
      expect(screen.getByText("This watch link is invalid or turned off.")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Back to Home" }));
      expect(await screen.findByRole("heading", { name: "Ready for poker night?" })).toBeInTheDocument();
    });

    it("lets the host turn the watch link on, rotate it, and turn it off", async () => {
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
        lastKnownVersion: 0
      });
      const fake = fakeTransport(local);
      renderGameApp(fake.transport);
      const host = (watchLinkOn: boolean, watcherCount = 0): HostRoomProjection => ({
        ...projection(local),
        guestCount: 0,
        guestRequests: [],
        joiningOpen: true,
        guests: [],
        controllerStatus: "active",
        watchLinkOn,
        watcherCount
      });
      act(() => fake.emitHost(host(false)));
      const dialog = await screen.findByRole("dialog", { name: "Share game" });
      expect(within(dialog).getByRole("button", { name: "Players" })).toHaveAttribute("aria-pressed", "true");
      fireEvent.click(within(dialog).getByRole("button", { name: "Watchers" }));
      expect(within(dialog).queryByRole("textbox", { name: "Invite link" })).not.toBeInTheDocument();

      fireEvent.click(within(dialog).getByRole("button", { name: /Turn on watch link/ }));
      await waitFor(() => expect(fake.rotateSpectatorLink).toHaveBeenCalledTimes(1));
      const { spectatorSecret } = fake.rotateSpectatorLink.mock.calls[0]![0];
      expect(spectatorSecret).toEqual(expect.any(String));
      act(() => fake.emitHost(host(true, 2)));
      const watchLink = () => (within(dialog).getByRole("textbox", { name: "Watch link" }) as HTMLInputElement).value;
      expect(watchLink()).toContain(`#/watch/room_public_123456/${spectatorSecret}`);
      expect(watchLink()).not.toContain("host_abcdefghijklmnopqrstuvwxyz0123456789");
      expect(within(dialog).getByLabelText("Watch link QR code")).toBeInTheDocument();
      expect(within(dialog).getByText("2 watching")).toBeInTheDocument();
      const stored = () => JSON.parse(localStorage.getItem("poker-tracker:v1:hosted-room") ?? "null");
      expect(stored()).toMatchObject({ spectatorSecret });

      fireEvent.click(within(dialog).getByRole("button", { name: /Rotate link/ }));
      await waitFor(() => expect(fake.rotateSpectatorLink).toHaveBeenCalledTimes(2));
      const rotated = fake.rotateSpectatorLink.mock.calls[1]![0].spectatorSecret;
      expect(rotated).not.toBe(spectatorSecret);
      await waitFor(() => expect(watchLink()).toContain(rotated!));
      // A later room update keeps the new link, on screen and in storage.
      act(() => fake.emitHost({ ...host(true, 0), version: 1 }));
      expect(watchLink()).toContain(rotated!);
      expect(stored()).toMatchObject({ spectatorSecret: rotated, lastKnownVersion: 1 });

      fireEvent.click(within(dialog).getByRole("button", { name: /Turn off/ }));
      await waitFor(() => expect(fake.rotateSpectatorLink).toHaveBeenCalledTimes(3));
      expect(fake.rotateSpectatorLink.mock.calls[2]![0].spectatorSecret).toBeNull();
      act(() => fake.emitHost({ ...host(false), version: 1 }));
      expect(within(dialog).getByRole("button", { name: /Turn on watch link/ })).toBeInTheDocument();
      await waitFor(() => expect(stored().spectatorSecret).toBeUndefined());
    });

    it("tells a host tab when another tab replaced its watch link", async () => {
      const local = createDefaultGameState();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(local));
      const spectatorSecret = "watch_abcdefghijklmnopqrstuvwxyz0123456789";
      saveHostRecovery({
        schemaVersion: 1,
        publicId: "room_public_123456",
        localGameId: local.localGameId,
        hostSecret: "host_abcdefghijklmnopqrstuvwxyz0123456789",
        inviteSecret: "invite_abcdefghijklmnopqrstuvwxyz0123456789",
        inviteUrl: "https://example.test/#/join/room_public_123456/invite",
        roomName: "Poker Night",
        lastKnownVersion: 0,
        spectatorSecret
      });
      const fake = fakeTransport(local);
      renderGameApp(fake.transport);
      const host = (watchLinkId: string): HostRoomProjection => ({
        ...projection(local),
        guestCount: 0,
        guestRequests: [],
        joiningOpen: true,
        guests: [],
        controllerStatus: "active",
        watchLinkOn: true,
        watchLinkId,
        watcherCount: 0
      });
      const currentId = await watchLinkIdForSecret(spectatorSecret);
      act(() => fake.emitHost(host(currentId)));
      const dialog = await screen.findByRole("dialog", { name: "Share game" });
      fireEvent.click(within(dialog).getByRole("button", { name: "Watchers" }));
      expect(within(dialog).getByRole("textbox", { name: "Watch link" })).toBeInTheDocument();

      act(() => fake.emitHost(host("0123456789abcdef")));
      expect(await within(dialog).findByText(/changed in another tab/)).toBeInTheDocument();
      expect(within(dialog).queryByRole("textbox", { name: "Watch link" })).not.toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: /New watch link/ })).toBeInTheDocument();
    });

    it("returns a host who opens a watch link to their hosted room on leaving", async () => {
      const local = createDefaultGameState();
      local.settings.gameName = "Hosted here";
      localStorage.setItem(STORAGE_KEY, JSON.stringify(local));
      saveHostRecovery({
        schemaVersion: 1,
        publicId: "room_hosted_123456",
        localGameId: local.localGameId,
        hostSecret: "host_abcdefghijklmnopqrstuvwxyz0123456789",
        inviteSecret: "invite_abcdefghijklmnopqrstuvwxyz0123456789",
        inviteUrl: "https://example.test/#/join/room_hosted_123456/invite",
        roomName: "Hosted here",
        lastKnownVersion: 0
      });
      const fake = fakeTransport();
      window.history.replaceState(null, "", watchHash);
      render(<App roomTransport={fake.transport} />);
      act(() => fake.emitSpectator(spectatorProjection(watchedState())));
      fireEvent.click(await screen.findByRole("button", { name: "Leave" }));

      expect(await screen.findByRole("dialog", { name: "Share game" })).toBeInTheDocument();
      expect(screen.getByText("Shared host ledger")).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Welcome back" })).not.toBeInTheDocument();
      expect(window.location.hash).toBe("");
    });

    it("returns a guest who opens a watch link to their guest session on leaving", async () => {
      saveGuestSession({
        schemaVersion: 1,
        publicId: "room_guest_1234567",
        guestSecret: "guest_abcdefghijklmnopqrstuvwxyz0123456789",
        presenceSessionId: "presence_abcdefghijkl",
        displayName: "Riley"
      });
      const fake = fakeTransport();
      window.history.replaceState(null, "", watchHash);
      render(<App roomTransport={fake.transport} />);
      act(() => fake.emitSpectator(spectatorProjection(watchedState())));
      fireEvent.click(await screen.findByRole("button", { name: "Leave" }));

      await waitFor(() => expect(window.location.hash).toBe("#/room/room_guest_1234567"));
      act(() =>
        fake.emitGuest({ ...projection(createDefaultGameState()), publicId: "room_guest_1234567", displayName: "Riley" })
      );
      expect(await screen.findByText(/Riley/)).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Ready for poker night?" })).not.toBeInTheDocument();
    });
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

  describe("players confirm each other", () => {
    const guestSecret = "guest_abcdefghijklmnopqrstuvwxyz0123456789";
    function openAsGuest(fake: ReturnType<typeof fakeTransport>) {
      saveRoomHistoryCredential({
        schemaVersion: 1,
        publicId: "room_public_123456",
        role: "guest",
        secret: guestSecret,
        roomName: "Poker Night",
        joinedAt: Date.now(),
        displayName: "Maya"
      });
      window.history.replaceState(null, "", "/#/room/room_public_123456");
      renderGameApp(fake.transport);
    }
    function agreementView(overrides: Partial<RoomAgreement>): RoomAgreement {
      return {
        id: "agreement_1" as never,
        kind: "give",
        amountCents: 2000,
        note: null,
        proposerPlayerId: "player_x",
        proposerName: "Player",
        counterpartyPlayerId: null,
        counterpartyName: null,
        witnessPlayerId: null,
        witnessName: null,
        status: "open",
        closedReason: null,
        bounceReason: null,
        bouncedByHost: false,
        createdAt: Date.now(),
        expiresAt: Date.now() + 30 * 60_000,
        decidedAt: null,
        confirmedByPlayerId: null,
        confirmedByName: null,
        confirmedVia: null,
        transactionId: null,
        voided: false,
        ...overrides
      };
    }
    function guestRoom(
      state: GameState,
      overrides: Partial<GuestRoomProjection> = {}
    ): GuestRoomProjection {
      return {
        ...projection(state),
        displayName: "Maya",
        seatPlayerId: state.players[1]!.id,
        seats: state.players.map((player, index) => ({
          playerId: player.id,
          name: player.name,
          claimed: index === 1 || index === 2,
          isHost: index === 0
        })),
        peerConfirm: true,
        agreements: { needsMe: [], mine: [], bounced: [], recentDone: [] },
        ...overrides
      };
    }
    const guestModes = () => screen.getByRole("navigation", { name: "Poker tracker modes" });

    it("gives a seated guest Table, Chips, and Inbox, and keeps Play and Settle otherwise", async () => {
      const remote = createDefaultGameState();
      const [, me, other] = remote.players as [GameState["players"][number], GameState["players"][number], GameState["players"][number]];
      const fake = fakeTransport(remote);
      openAsGuest(fake);
      const waiting = agreementView({
        proposerPlayerId: other.id,
        proposerName: other.name,
        counterpartyPlayerId: me.id,
        counterpartyName: me.name
      });
      act(() => fake.emitGuest(guestRoom(remote, {
        agreements: { needsMe: [waiting], mine: [], bounced: [], recentDone: [] }
      })));
      expect(await screen.findByText(`Playing as ${me.name}`)).toBeInTheDocument();
      expect(within(guestModes()).getByRole("button", { name: "Table" })).toHaveAttribute("aria-current", "page");
      expect(within(guestModes()).getByRole("button", { name: "Chips" })).toBeInTheDocument();
      expect(within(guestModes()).getByRole("button", { name: "Inbox, 1 waiting" })).toBeInTheDocument();
      expect(within(guestModes()).queryByRole("button", { name: "Play" })).not.toBeInTheDocument();
      // Nothing to settle yet, so no Settle tab.
      expect(within(guestModes()).queryByRole("button", { name: "Settle" })).not.toBeInTheDocument();
      const you = screen.getByRole("region", { name: "You" });
      expect(within(you).getByRole("heading", { name: me.name })).toBeInTheDocument();
      // Your own row on the read-only table is marked.
      const mySeat = screen.getAllByRole("article").find((article) =>
        within(article).queryByRole("heading", { name: me.name, level: 3 })
      );
      expect(mySeat).toHaveClass("is-you");
      expect(within(mySeat!).getByText("You")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /1 waiting on you/ }));
      expect(within(guestModes()).getByRole("button", { name: "Inbox, 1 waiting" })).toHaveAttribute("aria-current", "page");
      expect(screen.getByRole("article", { name: `${other.name} gave you $20 in chips` })).toBeInTheDocument();

      // Once the game ends, the settlement is a tab away.
      act(() => fake.emitGuest(guestRoom(remote, { status: "ended", endedAt: Date.now() })));
      expect(within(guestModes()).getByRole("button", { name: "Settle" })).toBeInTheDocument();

      // Without a seat, or with the host approving everything, it's Play and Settle as before.
      act(() => fake.emitGuest(guestRoom(remote, { seatPlayerId: null })));
      expect(within(guestModes()).getByRole("button", { name: "Play" })).toBeInTheDocument();
      expect(within(guestModes()).getByRole("button", { name: "Settle" })).toBeInTheDocument();
      expect(within(guestModes()).queryByRole("button", { name: "Chips" })).not.toBeInTheDocument();
      act(() => fake.emitGuest(guestRoom(remote, { peerConfirm: false })));
      expect(within(guestModes()).getByRole("button", { name: "Play" })).toBeInTheDocument();
      expect(within(guestModes()).queryByRole("button", { name: /Inbox/ })).not.toBeInTheDocument();
      expect(await screen.findByRole("button", { name: "Request transaction" })).toBeInTheDocument();
    });

    it("lists a seated guest's chip moves as facts, without guessing who pays whom", async () => {
      const remote = createDefaultGameState();
      const [, me, other, third] = remote.players as [
        GameState["players"][number],
        GameState["players"][number],
        GameState["players"][number],
        GameState["players"][number]
      ];
      const at = new Date(0).toISOString();
      remote.transactions = [
        { id: "t1", type: "bank_buy_in", createdAt: at, amountCents: 4000, toPlayerId: me.id },
        { id: "t2", type: "player_gave", createdAt: at, amountCents: 2000, fromPlayerId: other.id, toPlayerId: me.id },
        { id: "t3", type: "player_gave", createdAt: at, amountCents: 1000, fromPlayerId: me.id, toPlayerId: third.id }
      ];
      const fake = fakeTransport(remote);
      openAsGuest(fake);
      act(() => fake.emitGuest(guestRoom(remote)));
      const you = await screen.findByRole("region", { name: "You" });
      expect(within(you).getByRole("list", { name: "Your chips" })).toHaveTextContent(
        `$40 from the bank` + `Bought $20 from ${other.name}` + `Gave $10 to ${third.name}`
      );
      expect(within(you).getByText("In for $50")).toBeInTheDocument();
      expect(within(you).queryByText(/owe/)).not.toBeInTheDocument();
    });

    it("sends chips from Chips, lands on Inbox, and answers from Inbox", async () => {
      const remote = createDefaultGameState();
      const [, me, other] = remote.players as [GameState["players"][number], GameState["players"][number], GameState["players"][number]];
      const fake = fakeTransport(remote);
      const proposeAgreement = vi.fn(async (_args: Parameters<NonNullable<RoomTransport["proposeAgreement"]>>[0]) => "agreement_new" as never);
      const answerAgreement = vi.fn(async (_args: Parameters<NonNullable<RoomTransport["answerAgreement"]>>[0]) => ({ status: "recorded" as const, reason: null }));
      Object.assign(fake.transport, { proposeAgreement, answerAgreement });
      openAsGuest(fake);
      act(() => fake.emitGuest(guestRoom(remote)));
      fireEvent.click(await within(guestModes()).findByRole("button", { name: "Chips" }));
      fireEvent.click(screen.getByRole("button", { name: "Give to" }));
      fireEvent.click(within(screen.getByRole("group", { name: "Player" })).getByRole("button", { name: new RegExp(other.name) }));
      fireEvent.click(screen.getByRole("button", { name: /\$20$/ }));
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: `Send to ${other.name} to confirm` }));
      });
      expect(proposeAgreement.mock.calls[0]![0]).toMatchObject({
        publicId: "room_public_123456",
        guestSecret,
        kind: "give",
        amountCents: 2000,
        counterpartyPlayerId: other.id
      });
      expect(within(guestModes()).getByRole("button", { name: "Inbox" })).toHaveAttribute("aria-current", "page");
      // The status region is announced once filled, and takes focus.
      const status = screen.getByRole("status");
      await waitFor(() => expect(status).toHaveTextContent(`Sent. Waiting on ${other.name} to confirm.`));
      expect(status).toHaveFocus();

      act(() => fake.emitGuest(guestRoom(remote, {
        agreements: {
          needsMe: [agreementView({
            id: "agreement_buy" as never,
            kind: "buy",
            proposerPlayerId: other.id,
            proposerName: other.name,
            counterpartyPlayerId: me.id,
            counterpartyName: me.name
          })],
          mine: [],
          bounced: [],
          recentDone: []
        }
      })));
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
      });
      expect(answerAgreement.mock.calls[0]![0]).toMatchObject({
        publicId: "room_public_123456",
        guestSecret,
        agreementId: "agreement_buy",
        answer: "confirm"
      });

      // Anything else still goes to the host as a request.
      fireEvent.click(within(guestModes()).getByRole("button", { name: "Chips" }));
      fireEvent.click(screen.getByRole("button", { name: "Something else? Ask the host" }));
      expect(screen.getByRole("dialog", { name: "Request transaction" })).toBeInTheDocument();
    });

    it("keeps a Chips draft and its request id across tab switches, so a retry can't send twice", async () => {
      const remote = createDefaultGameState();
      const other = remote.players[2]!;
      const fake = fakeTransport(remote);
      const proposeAgreement = vi
        .fn(async (_args: Parameters<NonNullable<RoomTransport["proposeAgreement"]>>[0]) => "agreement_new" as never)
        .mockRejectedValueOnce(new Error("network unavailable"));
      Object.assign(fake.transport, { proposeAgreement });
      openAsGuest(fake);
      act(() => fake.emitGuest(guestRoom(remote)));
      fireEvent.click(await within(guestModes()).findByRole("button", { name: "Chips" }));
      fireEvent.click(screen.getByRole("button", { name: "Give to" }));
      fireEvent.click(within(screen.getByRole("group", { name: "Player" })).getByRole("button", { name: new RegExp(other.name) }));
      fireEvent.change(screen.getByRole("textbox", { name: "Amount" }), { target: { value: "15" } });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: `Send to ${other.name} to confirm` }));
      });
      expect(proposeAgreement).toHaveBeenCalledTimes(1);

      fireEvent.click(within(guestModes()).getByRole("button", { name: "Table" }));
      fireEvent.click(within(guestModes()).getByRole("button", { name: "Chips" }));
      expect(screen.getByRole("textbox", { name: "Amount" })).toHaveValue("15");
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: `Send to ${other.name} to confirm` }));
      });
      expect(proposeAgreement).toHaveBeenCalledTimes(2);
      const [first, second] = proposeAgreement.mock.calls.map(([args]) => args.clientRequestId);
      expect(second).toBe(first);
      expect(within(guestModes()).getByRole("button", { name: "Inbox" })).toHaveAttribute("aria-current", "page");
    });

    it("shows the host what needs them, counts it on the sharing button, and toggles the mode", async () => {
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
        lastKnownVersion: 0
      });
      const fake = fakeTransport(local);
      const setPeerConfirm = vi.fn(async (_args: Parameters<NonNullable<RoomTransport["setPeerConfirm"]>>[0]) => undefined);
      const hostAnswerAgreement = vi.fn(async (_args: Parameters<NonNullable<RoomTransport["hostAnswerAgreement"]>>[0]) => ({ status: "recorded" as const, reason: null }));
      const hostResolveBounced = vi.fn(async (_args: Parameters<NonNullable<RoomTransport["hostResolveBounced"]>>[0]) => ({ status: "recorded" as const, reason: null }));
      Object.assign(fake.transport, { setPeerConfirm, hostAnswerAgreement, hostResolveBounced });
      renderGameApp(fake.transport);
      const [, maya, dev] = local.players as [GameState["players"][number], GameState["players"][number], GameState["players"][number]];
      act(() => fake.emitHost({
        ...projection(local),
        guestCount: 1,
        guestRequests: [],
        joiningOpen: true,
        guests: [],
        controllerStatus: "active",
        peerConfirm: true,
        needsHost: {
          answer: [{
            ...agreementView({
              id: "agreement_seat" as never,
              proposerPlayerId: maya.id,
              proposerName: maya.name,
              counterpartyPlayerId: dev.id,
              counterpartyName: dev.name
            }),
            answerAs: "seat"
          }],
          bounced: [agreementView({
            id: "agreement_bounced" as never,
            kind: "buy",
            status: "bounced",
            proposerPlayerId: maya.id,
            proposerName: maya.name,
            counterpartyPlayerId: dev.id,
            counterpartyName: dev.name
          })]
        }
      }));
      const dialog = await screen.findByRole("dialog", { name: "Share game" });
      const needs = within(dialog).getByRole("region", { name: /Needs you/ });
      const seatItem = within(needs).getByRole("article", { name: `${maya.name} gave ${dev.name} $20 in chips` });
      expect(within(seatItem).getByText(`for ${dev.name} (no phone when sent)`)).toBeInTheDocument();
      fireEvent.click(within(seatItem).getByRole("button", { name: "Confirm" }));
      await waitFor(() => expect(hostAnswerAgreement).toHaveBeenCalledWith(expect.objectContaining({
        publicId: "room_public_123456",
        hostSecret: "host_abcdefghijklmnopqrstuvwxyz0123456789",
        agreementId: "agreement_seat",
        answer: "confirm",
        controllerId: expect.any(String)
      })));
      fireEvent.click(within(needs).getByRole("button", { name: "Record anyway" }));
      await waitFor(() => expect(hostResolveBounced).toHaveBeenCalledWith(expect.objectContaining({
        agreementId: "agreement_bounced",
        decision: "record"
      })));

      const toggle = within(dialog).getByRole("checkbox", { name: /Players confirm each other/ });
      expect(toggle).toBeChecked();
      fireEvent.click(toggle);
      await waitFor(() => expect(setPeerConfirm).toHaveBeenCalledWith(expect.objectContaining({ on: false })));

      fireEvent.click(within(dialog).getByTitle("Close"));
      const button = screen.getByRole("button", { name: "Sharing live, 2 entries need you" });
      expect(within(button).getByText("2")).toBeInTheDocument();
    });
  });
});
