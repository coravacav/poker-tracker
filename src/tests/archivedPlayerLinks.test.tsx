import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { playedOnLabels } from "../components/HistoryGameList";
import { SessionHistoryPanel } from "../components/SessionHistoryPanel";
import { buildPersonTimelines } from "../domain/historyTrends";
import {
  identifyPlayer,
  indexPeople,
  linkGamePlayers,
  mergeIntoPerson,
  relinkPlayer,
  separatePerson,
  type PeopleDirectory,
  type Person
} from "../domain/people";
import type { GameState, Player } from "../domain/pokerTypes";
import { buildPersonSuggestions, buildPlayerHistoryStats, parseArchivedEntry, type ArchivedGame } from "../domain/sessionHistory";
import { relinkArchivedPlayers } from "../state/archivedPlayerLinks";
import { buildBackup, parseBackup } from "../state/backup";
import {
  ARCHIVE_CHANNEL_NAME,
  GAME_ARCHIVE_CHANGED_EVENT,
  GAME_ARCHIVE_KEY,
  getArchiveBackend,
  loadArchivedGames,
  mergeArchivedGames,
  peekArchivedGames,
  resetGameArchiveForTests
} from "../state/gameArchive";
import { openArchiveDb, readArchiveRecords, type ArchiveRecord } from "../state/gameArchiveIdb";
import { PEOPLE_KEY, loadPeopleDirectory, resetPeopleStoreForTests } from "../state/peopleStore";
import { migratePersistedState } from "../state/persistence";
import { createDefaultGameState } from "../state/seedGame";
import { clearUnsavedQuarantineCopies } from "../state/storageQuarantine";

const NOW = "2026-10-14T12:00:00.000Z";

function person(id: string, name: string, extra: Partial<Person> = {}): Person {
  return { id, name, aliases: [], createdAt: NOW, updatedAt: NOW, ...extra };
}

function directoryOf(...people: Person[]): PeopleDirectory {
  return { schemaVersion: 1, people };
}

function storePeople(...people: Person[]) {
  localStorage.setItem(PEOPLE_KEY, JSON.stringify(directoryOf(...people)));
  resetPeopleStoreForTests();
}

type Seat = { name: string; personId?: string; lostCents?: number };

/** A game on `day` (January 2026) where every seat bought in and lost `lostCents` (default $10). */
function game(name: string, day: number, seats: Seat[]): ArchivedGame {
  const state = createDefaultGameState();
  const at = new Date(Date.UTC(2026, 0, day)).toISOString();
  state.settings.gameName = name;
  state.players = seats.map((seat, index): Player => ({
    id: `p${index}`,
    name: seat.name,
    seatIndex: index,
    isActive: true,
    ...(seat.personId ? { personId: seat.personId } : {})
  }));
  state.transactions = seats.map((seat, index) => ({
    id: `t${index}`,
    type: "bank_buy_in" as const,
    toPlayerId: `p${index}`,
    amountCents: seat.lostCents ?? 1000,
    createdAt: at
  }));
  return { archivedAt: at, state };
}

async function storedRecords(): Promise<ArchiveRecord[]> {
  const db = await openArchiveDb(indexedDB, 1000);
  try {
    return await readArchiveRecords(db);
  } finally {
    db.close();
  }
}

const statFor = (games: ArchivedGame[], key: string) =>
  buildPlayerHistoryStats(games, loadPeopleDirectory()).find((stat) => stat.key === key);

/** Three games where "Alex" is person_alex; the middle one was really someone else. */
async function seedAlexGames() {
  storePeople(person("person_alex", "Alex"), person("person_blair", "Blair"));
  const games = [
    game("Week 1", 1, [{ name: "Alex", personId: "person_alex" }, { name: "Blair", personId: "person_blair" }]),
    game("Week 2", 2, [{ name: "Alex", personId: "person_alex", lostCents: 5000 }]),
    // Legacy game: no links, so "Alex" only matches by name.
    game("Week 3", 3, [{ name: "alex" }])
  ];
  expect(await mergeArchivedGames(games)).toBe(true);
  return games;
}

beforeEach(() => {
  localStorage.clear();
  clearUnsavedQuarantineCopies();
});
afterEach(() => vi.restoreAllMocks());

describe("correcting a player's person (domain)", () => {
  const directory = directoryOf(person("person_alex", "Alex"), person("person_sam", "Sam"));
  const alex: Player = { id: "p1", name: "Alex", seatIndex: 0, isActive: true, personId: "person_alex" };

  it("unlinks and marks the person so the name cannot match them again", () => {
    const unlinked = relinkPlayer(alex, { kind: "unlink", personId: "person_alex" }, directory);
    expect(unlinked).toEqual({ id: "p1", name: "Alex", seatIndex: 0, isActive: true, notPersonIds: ["person_alex"] });
    const index = indexPeople(directory);
    expect(identifyPlayer(index, unlinked)).toEqual({ nameKey: "alex" });
    // Archiving the same player again does not relink it, and does not create a namesake.
    const state = { ...createDefaultGameState(), players: [unlinked], transactions: [] };
    const linked = linkGamePlayers(state, directory, NOW, () => "person_new");
    expect(linked.state.players[0]).toEqual(unlinked);
    expect(linked.directory.people).toHaveLength(2);
  });

  it("links to another person, clearing marks against them and marking the old person", () => {
    const marked = relinkPlayer(alex, { kind: "unlink", personId: "person_alex" }, directory);
    const moved = relinkPlayer({ ...marked, notPersonIds: ["person_sam", "person_alex"] }, { kind: "link", personId: "person_sam", fromPersonId: "person_alex" }, directory);
    expect(moved.personId).toBe("person_sam");
    expect(moved.notPersonIds).toEqual(["person_alex"]);
    expect(identifyPlayer(indexPeople(directory), moved)).toEqual({ personId: "person_sam" });
  });

  it("keeps the mark through merges and separations of that person", () => {
    const unlinked = relinkPlayer(alex, { kind: "unlink", personId: "person_alex" }, directory);
    const merged = mergeIntoPerson(directory, [{ personId: "person_sam" }, { personId: "person_alex" }], "Sam", NOW, "unused");
    if ("error" in merged) throw new Error(merged.error);
    // "Alex" now resolves to Sam's group, which includes the person it was marked as not being.
    expect(identifyPlayer(indexPeople(merged.directory), unlinked)).toEqual({ nameKey: "alex" });
    const separated = separatePerson(merged.directory, "person_alex", NOW);
    expect(identifyPlayer(indexPeople(separated), unlinked)).toEqual({ nameKey: "alex" });
  });

  it("drops unusable marks on load and keeps older entries readable", () => {
    const state = game("Old", 1, [{ name: "Alex" }]).state;
    const stored = {
      ...state,
      players: [{ ...state.players[0], notPersonIds: ["person_alex", "bad id!", 7, "person_alex"] }]
    };
    expect(migratePersistedState(stored as GameState).players[0].notPersonIds).toEqual(["person_alex"]);
    const junk = { ...state, players: [{ ...state.players[0], notPersonIds: "person_alex" }] };
    expect(migratePersistedState(junk as unknown as GameState).players[0]).not.toHaveProperty("notPersonIds");
    expect(parseArchivedEntry({ archivedAt: NOW, editedAt: "not a date", state })).not.toHaveProperty("editedAt");
    expect(parseArchivedEntry({ archivedAt: NOW, editedAt: NOW, state })?.editedAt).toBe(NOW);
  });
});

describe("relinking archived games", () => {
  it("unlinks one game only, and its name does not link it back", async () => {
    const games = await seedAlexGames();
    const before = await storedRecords();
    let loaded = await loadArchivedGames();
    expect(statFor(loaded, "person:person_alex")).toMatchObject({ games: 3, results: [{ totalNetCents: -7000 }] });

    const week2 = games[1].state.localGameId;
    expect(await relinkArchivedPlayers([{ gameId: week2, playerId: "p0" }], { kind: "unlink", personId: "person_alex" }, new Date(NOW)))
      .toEqual({ ok: true });

    const after = await storedRecords();
    for (const record of before) {
      const now = after.find((candidate) => candidate.id === record.id)!;
      if (record.id === week2) {
        expect(now.rev).not.toBe(record.rev);
        expect(now.entry).toMatchObject({ archivedAt: games[1].archivedAt, editedAt: NOW });
      } else {
        // Untouched games keep their record exactly.
        expect(now).toEqual(record);
      }
    }

    loaded = await loadArchivedGames();
    const edited = loaded.find((entry) => entry.state.localGameId === week2)!;
    expect(edited.state.players[0]).not.toHaveProperty("personId");
    expect(edited.state.players[0].notPersonIds).toEqual(["person_alex"]);
    expect(statFor(loaded, "person:person_alex")).toMatchObject({ games: 2, results: [{ totalNetCents: -2000 }] });
    expect(statFor(loaded, "name:alex")).toMatchObject({ games: 1, keptApart: true, results: [{ totalNetCents: -5000 }] });

    // Still apart after a reload, and the unlinked row is not offered as a name to link.
    resetGameArchiveForTests();
    resetPeopleStoreForTests();
    loaded = await loadArchivedGames();
    expect(statFor(loaded, "person:person_alex")?.games).toBe(2);
    const suggestions = buildPersonSuggestions(buildPlayerHistoryStats(loaded, loadPeopleDirectory()), loadPeopleDirectory());
    expect(suggestions.map((suggestion) => suggestion.key)).not.toContain("name:alex");

    // The over-time charts follow the same rows.
    const timelines = buildPersonTimelines(loaded, loadPeopleDirectory(), "USD");
    expect(timelines.find((timeline) => timeline.key === "person:person_alex")?.results.map((result) => result.gameName))
      .toEqual(["Week 1", "Week 3"]);
    expect(timelines.find((timeline) => timeline.key === "name:alex")).toMatchObject({
      name: "Alex (unlinked)",
      results: [expect.objectContaining({ gameName: "Week 2", netCents: -5000 })]
    });
  });

  it("relinks a name-matched legacy game to another person, or to a new person", async () => {
    const games = await seedAlexGames();
    const week3 = games[2].state.localGameId;
    expect(await relinkArchivedPlayers([{ gameId: week3, playerId: "p0" }], { kind: "person", personId: "person_blair", fromPersonId: "person_alex" }))
      .toEqual({ ok: true, personId: "person_blair" });
    let loaded = await loadArchivedGames();
    expect(statFor(loaded, "person:person_blair")?.games).toBe(2);
    expect(statFor(loaded, "person:person_alex")?.games).toBe(2);

    // A new person needs a name nobody uses yet.
    expect(await relinkArchivedPlayers([{ gameId: week3, playerId: "p0" }], { kind: "new", name: "alex" }))
      .toEqual({ error: expect.stringMatching(/already uses the name/) });
    const result = await relinkArchivedPlayers([{ gameId: week3, playerId: "p0" }], { kind: "new", name: "Alex K", fromPersonId: "person_blair" });
    expect(result).toMatchObject({ ok: true });
    const newId = (result as { personId: string }).personId;
    expect(loadPeopleDirectory().people.find((entry) => entry.id === newId)?.name).toBe("Alex K");
    loaded = await loadArchivedGames();
    expect(statFor(loaded, `person:${newId}`)?.games).toBe(1);
    expect(statFor(loaded, "person:person_blair")?.games).toBe(1);
    const player = loaded.find((entry) => entry.state.localGameId === week3)!.state.players[0];
    expect(player).toMatchObject({ personId: newId, notPersonIds: ["person_alex", "person_blair"] });
  });

  it("refreshes this tab and tells other tabs", async () => {
    const games = await seedAlexGames();
    await loadArchivedGames();
    const otherTab = new BroadcastChannel(ARCHIVE_CHANNEL_NAME);
    const received = new Promise((resolve) => { otherTab.onmessage = resolve; });
    const changed = vi.fn();
    window.addEventListener(GAME_ARCHIVE_CHANGED_EVENT, changed);

    await relinkArchivedPlayers([{ gameId: games[0].state.localGameId, playerId: "p0" }], { kind: "unlink", personId: "person_alex" });
    window.removeEventListener(GAME_ARCHIVE_CHANGED_EVENT, changed);
    await received;
    otherTab.close();
    expect(changed).toHaveBeenCalledTimes(1);
    expect(peekArchivedGames()).toBeUndefined();
  });

  it("does nothing when the change is already there", async () => {
    const games = await seedAlexGames();
    const ref = [{ gameId: games[1].state.localGameId, playerId: "p0" }];
    await relinkArchivedPlayers(ref, { kind: "unlink", personId: "person_alex" });
    const records = await storedRecords();
    expect(await relinkArchivedPlayers(ref, { kind: "unlink", personId: "person_alex" })).toEqual({
      error: expect.stringMatching(/already changed/)
    });
    expect(await storedRecords()).toEqual(records);
  });

  it("writes through the localStorage fallback, leaving other entries as stored", async () => {
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, writable: true, value: undefined });
    storePeople(person("person_alex", "Alex"));
    const [one, two] = [game("One", 1, [{ name: "Alex", personId: "person_alex" }]), game("Two", 2, [{ name: "Alex" }])];
    const future = { archivedAt: "2026-01-03T00:00:00.000Z", state: { ...one.state, localGameId: "game_future_1", schemaVersion: 99 } };
    // Stored as an older build left it (no defaults filled in), next to an entry this build cannot read.
    localStorage.setItem(GAME_ARCHIVE_KEY, JSON.stringify([future, two, one]));
    expect(await getArchiveBackend()).toBe("localStorage");
    expect((await loadArchivedGames()).map((entry) => entry.state.settings.gameName)).toEqual(["Two", "One"]);

    expect(await relinkArchivedPlayers([{ gameId: two.state.localGameId, playerId: "p0" }], { kind: "unlink", personId: "person_alex" }, new Date(NOW)))
      .toEqual({ ok: true });
    const stored = JSON.parse(localStorage.getItem(GAME_ARCHIVE_KEY)!) as unknown[];
    expect(stored[0]).toEqual(future);
    expect(stored[2]).toEqual(JSON.parse(JSON.stringify(one)));
    expect(stored[1]).toMatchObject({ editedAt: NOW, state: { players: [{ name: "Alex", notPersonIds: ["person_alex"] }] } });

    const loaded = await loadArchivedGames();
    expect(statFor(loaded, "person:person_alex")?.games).toBe(1);
    expect(statFor(loaded, "name:alex")?.keptApart).toBe(true);
  });

  it("round-trips through a full backup, and the edited copy wins over older copies", async () => {
    const games = await seedAlexGames();
    const week2 = games[1].state.localGameId;
    await relinkArchivedPlayers([{ gameId: week2, playerId: "p0" }], { kind: "unlink", personId: "person_alex" }, new Date(NOW));
    const backup = JSON.parse(JSON.stringify(buildBackup(null, await loadArchivedGames(), new Date(NOW), loadPeopleDirectory())));

    // Another device that has the same games, unedited.
    localStorage.clear();
    resetGameArchiveForTests();
    resetPeopleStoreForTests();
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, writable: true, value: new IDBFactory() });
    storePeople(person("person_alex", "Alex"), person("person_blair", "Blair"));
    await mergeArchivedGames(games);
    expect(statFor(await loadArchivedGames(), "person:person_alex")?.games).toBe(3);

    const parsed = parseBackup(backup)!;
    expect(parsed.archivedGames.find((entry) => entry.state.localGameId === week2)?.editedAt).toBe(NOW);
    expect(await mergeArchivedGames(parsed.archivedGames)).toBe(true);
    let loaded = await loadArchivedGames();
    expect(statFor(loaded, "person:person_alex")?.games).toBe(2);
    expect(statFor(loaded, "name:alex")?.games).toBe(1);

    // Restoring a backup from before the fix does not undo it.
    expect(await mergeArchivedGames(games)).toBe(true);
    loaded = await loadArchivedGames();
    expect(statFor(loaded, "person:person_alex")?.games).toBe(2);

    // Exporting again keeps the mark.
    const again = parseBackup(JSON.parse(JSON.stringify(buildBackup(null, loaded, new Date(NOW), loadPeopleDirectory()))))!;
    expect(again.archivedGames.find((entry) => entry.state.localGameId === week2)?.state.players[0].notPersonIds)
      .toEqual(["person_alex"]);
  });
});

describe("Player History game list", () => {
  async function renderHistory() {
    const games = await seedAlexGames();
    render(<SessionHistoryPanel />);
    await screen.findByText("3 archived games");
    return games;
  }

  const rowOf = (name: string) =>
    within(document.querySelector(".history-stat-list") as HTMLElement)
      .getByText(name, { selector: "strong" })
      .closest(".history-stat-row") as HTMLElement;

  it("lists a person's games and unlinks one", async () => {
    await renderHistory();
    fireEvent.click(within(rowOf("Alex")).getByRole("button", { name: "Alex" }));
    const list = screen.getByRole("list", { name: "Games for Alex" });
    expect(within(list).getAllByRole("listitem").map((item) => item.querySelector(".history-game-name")?.textContent))
      .toEqual(["Week 3", "Week 2", "Week 1"]);
    expect(within(list).getAllByRole("listitem")[0]).toHaveTextContent("as alex");
    expect(within(list).getAllByRole("listitem")[1]).toHaveTextContent("-$50.00");

    fireEvent.click(within(list).getByRole("button", { name: /^Change who Alex was in Week 2/ }));
    const form = screen.getByRole("form", { name: "Who Alex was in Week 2" });
    expect(within(form).getByLabelText("Counts for")).toHaveValue("unlink");
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Alex in Week 2 no longer counts for Alex.")).toBeInTheDocument();
    await waitFor(() => expect(rowOf("Alex")).toHaveTextContent("2 games"));
    expect(rowOf("Alex (unlinked)")).toHaveTextContent("1 game");
    expect(within(screen.getByRole("list", { name: "Games for Alex" })).getAllByRole("listitem")).toHaveLength(2);
  });

  it("moves a game to another person and to a new person", async () => {
    await renderHistory();
    fireEvent.click(within(rowOf("Alex")).getByRole("button", { name: "Alex" }));
    fireEvent.click(screen.getByRole("button", { name: /^Change who alex was in Week 3/ }));
    let form = screen.getByRole("form", { name: "Who alex was in Week 3" });
    fireEvent.change(within(form).getByLabelText("Counts for"), { target: { value: "person:person_blair" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("alex in Week 3 now counts for Blair.")).toBeInTheDocument();
    await waitFor(() => expect(rowOf("Blair")).toHaveTextContent("2 games"));

    fireEvent.click(screen.getByRole("button", { name: /^Change who Alex was in Week 2/ }));
    form = screen.getByRole("form", { name: "Who Alex was in Week 2" });
    fireEvent.change(within(form).getByLabelText("Counts for"), { target: { value: "new" } });
    // "Alex" is taken, so the name starts empty.
    expect(within(form).getByLabelText("New person's name")).toHaveValue("");
    fireEvent.change(within(form).getByLabelText("New person's name"), { target: { value: "Blair" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/already uses the name Blair/);

    fireEvent.change(within(form).getByLabelText("New person's name"), { target: { value: "Alex Kim" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Alex in Week 2 now counts for Alex Kim.")).toBeInTheDocument();
    await waitFor(() => expect(rowOf("Alex Kim")).toHaveTextContent("1 game"));
    expect(rowOf("Alex")).toHaveTextContent("1 game");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("names an unlinked row as a new person instead of merging its name", async () => {
    const games = await renderHistory();
    await relinkArchivedPlayers([{ gameId: games[1].state.localGameId, playerId: "p0" }], { kind: "unlink", personId: "person_alex" });
    await waitFor(() => expect(rowOf("Alex (unlinked)")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Merge or rename" }));
    expect(screen.getByRole("checkbox", { name: "Select Alex (unlinked)" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Rename Alex (unlinked)" }));
    fireEvent.change(screen.getByLabelText("New name for Alex (unlinked)"), { target: { value: "Alex Kim" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Select Alex Kim" })).toBeInTheDocument());
    expect(screen.getByRole("checkbox", { name: "Select Alex" }).closest(".history-stat-row")).toHaveTextContent("2 games");
    // The name stays with the original person: no alias was handed out.
    expect(loadPeopleDirectory().people.find((entry) => entry.name === "Alex Kim")?.aliases).toEqual([]);
  });
});

describe("game dates in a Player History row", () => {
  it("adds the time of day only where two games share a date", () => {
    const evening = new Date(2026, 9, 16, 19, 30).getTime();
    const lateNight = new Date(2026, 9, 16, 23, 5).getTime();
    const nextWeek = new Date(2026, 9, 23, 20, 0).getTime();
    const [first, second, third] = playedOnLabels([lateNight, evening, nextWeek]);
    const dateOnly = (ms: number) => new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" }).format(ms);

    expect(third).toBe(dateOnly(nextWeek));
    expect(first).not.toBe(second);
    for (const label of [first, second]) {
      expect(label).not.toBe(dateOnly(evening));
      expect(label).toContain(String(new Date(evening).getFullYear()));
    }
  });
});
