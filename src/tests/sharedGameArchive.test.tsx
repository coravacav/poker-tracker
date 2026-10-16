import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { SessionHistoryPanel } from "../components/SessionHistoryPanel";
import { GuestSessionControls } from "../components/SharingControls";
import type { GameState } from "../domain/pokerTypes";
import { archiveEntry, buildPlayerHistoryStats, parseArchivedEntry } from "../domain/sessionHistory";
import { sanitizeGuestState } from "../session/roomProtocol";
import type { RoomHistoryProjection } from "../session/types";
import { archiveGame, loadArchivedGames, updateArchivedGames } from "../state/gameArchive";
import { latestRoomPerGame, saveSharedGame, watchedRoomSave, sharedGameArchiveId, withoutSharedDuplicates } from "../state/sharedGameArchive";
import { createDefaultGameState } from "../state/seedGame";

const HOST_GAME_ID = "game_hosts_friday_night";

/** The host's game; `extra` adds later transactions (as a continued or re-shared game would have). */
function hostGame(cashOutCents = 3000, extra = 0): GameState {
  const state = createDefaultGameState();
  state.localGameId = HOST_GAME_ID;
  state.settings.gameName = "Friday";
  state.players = [
    { id: "p1", name: "Alex", seatIndex: 0, isActive: true, personId: "person_hosts_alex" },
    { id: "p2", name: "Blair", seatIndex: 1, isActive: true }
  ];
  state.transactions = [
    { id: "t1", type: "bank_buy_in", toPlayerId: "p1", amountCents: 2000, createdAt: "2026-10-09T19:00:00Z" },
    { id: "t2", type: "bank_buy_in", toPlayerId: "p2", amountCents: 2000, createdAt: "2026-10-09T19:00:00Z" },
    { id: "t3", type: "bank_cash_out", fromPlayerId: "p1", amountCents: cashOutCents, cashOutKind: "final", createdAt: "2026-10-09T22:00:00Z" },
    ...Array.from({ length: extra }, (_, index) => ({
      id: `x${index}`,
      type: "bank_buy_in" as const,
      toPlayerId: "p2",
      amountCents: 500,
      createdAt: new Date(Date.parse("2026-10-09T23:00:00Z") + index * 60_000).toISOString()
    }))
  ];
  return state;
}

function guestRoom(state: GameState, status: RoomHistoryProjection["status"] = "ended"): RoomHistoryProjection {
  return {
    publicId: "room_abcdefghijklmnopqr",
    status,
    name: "Friday",
    state: sanitizeGuestState(state),
    version: 3,
    endedAt: status === "ended" ? Date.parse("2026-10-09T23:30:00Z") : null,
    role: "guest",
    createdAt: Date.parse("2026-10-09T18:55:00Z"),
    displayName: "Casey"
  };
}

describe("saving a shared game as a guest", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("keeps one copy per game, whichever room it was shared in, saving one at a time", async () => {
    // The first room ended, then the host shared the same game again and played on.
    const results = await Promise.all([
      saveSharedGame(sanitizeGuestState(hostGame(3000)), 100),
      saveSharedGame(sanitizeGuestState(hostGame(3000, 2)), 200)
    ]);
    expect(results).toEqual(["saved", "saved"]);
    const games = await loadArchivedGames();
    expect(games.map((game) => game.state.localGameId)).toEqual([sharedGameArchiveId(HOST_GAME_ID)]);
    // The saves ran in the order they were asked for.
    expect(games[0].state.transactions).toHaveLength(5);
    expect(games[0].roomClosedAt).toBe(200);
  });

  it("refuses a copy from a room that closed before the kept copy's room, even without room history", async () => {
    expect(await saveSharedGame(sanitizeGuestState(hostGame(3000, 2)), 200)).toBe("saved");
    // Reopening the older room while room history has not loaded (or failed): the guest bar offers it...
    const older = { ...guestRoom(hostGame(3000)), endedAt: 100 };
    const offer = watchedRoomSave(older, []);
    expect(offer).not.toBeNull();
    // ...but the save itself refuses it.
    expect(await saveSharedGame(offer!.state, offer!.closedAt)).toBe("stale");
    const [kept] = await loadArchivedGames();
    expect(kept.state.transactions).toHaveLength(5);
    // The close time survives storage and backups.
    expect(parseArchivedEntry(archiveEntry(kept))?.roomClosedAt).toBe(200);
  });

  it("offers each game's save only on the room that ended last", async () => {
    const first = { ...guestRoom(hostGame()), publicId: "room_first_abcdefghijk", endedAt: Date.parse("2026-10-09T21:00:00Z") };
    const later = { ...guestRoom(hostGame(3000, 2)), publicId: "room_later_abcdefghijk", name: "Friday again" };
    expect(latestRoomPerGame([later, first])).toEqual(new Set([later.publicId]));

    render(<SessionHistoryPanel sharedRooms={[later, first]} />);
    fireEvent.click(await screen.findByText("Friday again"));
    fireEvent.click(screen.getByText("Friday"));
    expect(screen.getAllByRole("button", { name: "Save to Player History" })).toHaveLength(1);
    expect(screen.getByText("This game continued in a later room; save it from there.")).toBeInTheDocument();
  });

  it("keeps people links corrected on this device when the copy is updated", async () => {
    await saveSharedGame(sanitizeGuestState(hostGame()), 100);
    const id = sharedGameArchiveId(HOST_GAME_ID);
    await updateArchivedGames([id], (game) => ({
      ...game,
      state: {
        ...game.state,
        players: game.state.players.map((player) =>
          player.id === "p1" ? { ...player, personId: undefined, notPersonIds: [player.personId!] } : player
        )
      }
    }));
    const [corrected] = await loadArchivedGames();
    const unlinkedFrom = corrected.state.players.find((player) => player.id === "p1")!.notPersonIds;

    await saveSharedGame(sanitizeGuestState(hostGame(3000, 1)), 200);
    const [updated] = await loadArchivedGames();
    const alex = updated.state.players.find((player) => player.id === "p1")!;
    expect(alex.notPersonIds).toEqual(unlinkedFrom);
    // The exclusion holds: the exact name did not link Alex back to that person.
    expect(alex.personId === undefined || !unlinkedFrom!.includes(alex.personId)).toBe(true);
  });

  it("refuses games this device hosted, and never counts a game twice if both copies end up here", async () => {
    const host = hostGame();
    await archiveGame(host);
    expect(await saveSharedGame(sanitizeGuestState(host), 100)).toBe("hosted");
    expect((await loadArchivedGames()).map((game) => game.state.localGameId)).toEqual([HOST_GAME_ID]);

    // The other order: the guest copy first, then the host's own copy (say, from a restored backup).
    const guestCopy = { archivedAt: "2026-10-10T00:00:00Z", state: { ...sanitizeGuestState(host), localGameId: sharedGameArchiveId(HOST_GAME_ID) } };
    const hostCopy = { archivedAt: "2026-10-10T00:00:00Z", state: host };
    const shown = withoutSharedDuplicates([guestCopy, hostCopy]);
    expect(shown).toEqual([hostCopy]);
    expect(buildPlayerHistoryStats(shown).find((row) => row.name === "Alex")?.games).toBe(1);
  });

  it("keeps the id within the archive's limit for the longest game ids", () => {
    expect(sharedGameArchiveId("x".repeat(160))).toHaveLength(160);
  });

  it("saves a finished joined room from Player History and then offers to update it", async () => {
    render(<SessionHistoryPanel sharedRooms={[guestRoom(hostGame())]} />);
    expect(await screen.findByText(/Games you joined as a guest count in Player History once you save them/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Friday"));
    fireEvent.click(screen.getByRole("button", { name: "Save to Player History" }));

    expect(await screen.findByText("Saved to Player History.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Update in Player History" })).toBeInTheDocument());
    const stats = document.querySelector<HTMLElement>(".history-stat-list")!;
    expect(within(stats).getByText("Alex")).toBeInTheDocument();
    expect(within(stats).getByText("Blair")).toBeInTheDocument();
  });

  it("offers no save for rooms still being played or hosted here", async () => {
    render(
      <SessionHistoryPanel
        sharedRooms={[guestRoom(hostGame(), "active"), { ...guestRoom(hostGame()), publicId: "room_hosted_here_abcdef", role: "host", displayName: null }]}
      />
    );
    await screen.findAllByText("Friday");
    expect(screen.queryByRole("button", { name: "Save to Player History" })).not.toBeInTheDocument();
  });

  it("offers the guest bar's save only for the latest room of a game this device joined", () => {
    const first = { ...guestRoom(hostGame()), publicId: "room_first_abcdefghijk", endedAt: Date.parse("2026-10-09T21:00:00Z") };
    const later = { ...guestRoom(hostGame(3000, 2)), publicId: "room_later_abcdefghijk" };
    // Reopening the first room after joining (and saving) the later one.
    expect(watchedRoomSave(first, [first, later])).toBeNull();
    expect(watchedRoomSave(later, [first, later])).toEqual({ state: later.state, closedAt: later.endedAt });
    expect(watchedRoomSave({ ...later, status: "active", endedAt: null }, [first])).toBeNull();
    // An expired room with no end time is offered only once its creation time is known.
    const expired = { ...later, status: "expired" as const, endedAt: null };
    expect(watchedRoomSave(expired, [])).toBeNull();
    expect(watchedRoomSave(expired, [expired])).toEqual({ state: expired.state, closedAt: expired.createdAt });
  });

  it("offers a guest the final game once the host ends the room", () => {
    const state = { state: sanitizeGuestState(hostGame()), closedAt: 100 };
    const { rerender } = render(
      <GuestSessionControls connected ended={false} displayName="Casey" onLeave={() => undefined} savableGame={state} />
    );
    expect(screen.queryByRole("button", { name: "Save to Player History" })).not.toBeInTheDocument();
    rerender(<GuestSessionControls connected ended displayName="Casey" onLeave={() => undefined} savableGame={state} />);
    expect(screen.getByRole("button", { name: "Save to Player History" })).toBeEnabled();
  });
});
