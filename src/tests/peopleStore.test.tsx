import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlayerDrawer } from "../components/PlayerDrawer";
import { SessionHistoryPanel } from "../components/SessionHistoryPanel";
import { indexPeople, type PeopleDirectory, type Person } from "../domain/people";
import type { GameState } from "../domain/pokerTypes";
import { buildPlayerHistoryStats, type ArchivedGame } from "../domain/sessionHistory";
import { buildBackup, parseBackup } from "../state/backup";
import { archiveGame, loadArchivedGames, mergeArchivedGames } from "../state/gameArchive";
import {
  PEOPLE_KEY,
  canSavePeopleDirectory,
  loadPeopleDirectory,
  mergeStoredPeople,
  resetPeopleStoreForTests,
  updatePeopleDirectory
} from "../state/peopleStore";
import { createDefaultGameState } from "../state/seedGame";
import { QUARANTINE_PREFIX, clearUnsavedQuarantineCopies, listQuarantined } from "../state/storageQuarantine";

const NOW = "2026-10-14T12:00:00.000Z";

function person(id: string, name: string, extra: Partial<Person> = {}): Person {
  return { id, name, aliases: [], createdAt: NOW, updatedAt: NOW, ...extra };
}

function storePeople(...people: Person[]) {
  localStorage.setItem(PEOPLE_KEY, JSON.stringify({ schemaVersion: 1, people }));
  resetPeopleStoreForTests();
}

function playedGame(names: string[], buyInCents = 1000): GameState {
  const state = createDefaultGameState();
  state.players = names.map((name, index) => ({ id: `p${index}`, name, seatIndex: index, isActive: true }));
  state.transactions = names.map((_, index) => ({
    id: `t${index}`,
    type: "bank_buy_in" as const,
    toPlayerId: `p${index}`,
    amountCents: buyInCents,
    createdAt: NOW
  }));
  return state;
}

function legacy(names: string[], day: number): ArchivedGame {
  return { archivedAt: new Date(Date.UTC(2026, 0, day)).toISOString(), state: playedGame(names) };
}

beforeEach(() => {
  localStorage.clear();
  clearUnsavedQuarantineCopies();
});
afterEach(() => vi.restoreAllMocks());

describe("people storage", () => {
  it("links archived players to people and reuses them in later games", async () => {
    await archiveGame(playedGame(["Alex", "Player 2"]));
    const people = loadPeopleDirectory();
    expect(people.people.map((entry) => entry.name)).toEqual(["Alex"]);

    await archiveGame(playedGame([" alex"]));
    const games = await loadArchivedGames();
    expect(games.map((game) => game.state.players[0].personId)).toEqual([people.people[0].id, people.people[0].id]);
    expect(buildPlayerHistoryStats(games, loadPeopleDirectory())).toEqual(
      expect.arrayContaining([expect.objectContaining({ personId: people.people[0].id, games: 2 })])
    );
  });

  it("keeps a copy of unreadable or newer people data before replacing it", () => {
    localStorage.setItem(PEOPLE_KEY, "{not json");
    expect(loadPeopleDirectory().people).toEqual([]);
    expect(listQuarantined()).toEqual([expect.objectContaining({ sourceKey: PEOPLE_KEY, reason: "unreadable" })]);
    expect(canSavePeopleDirectory()).toBe(true);

    localStorage.clear();
    storePeople();
    localStorage.setItem(PEOPLE_KEY, JSON.stringify({ schemaVersion: 2, people: [] }));
    resetPeopleStoreForTests();
    expect(loadPeopleDirectory().people).toEqual([]);
    expect(listQuarantined()).toEqual([expect.objectContaining({ sourceKey: PEOPLE_KEY, reason: "newer_version" })]);
  });

  it("does not overwrite unreadable people data when no copy could be kept", () => {
    const raw = JSON.stringify({ schemaVersion: 2, people: [] });
    localStorage.setItem(PEOPLE_KEY, raw);
    resetPeopleStoreForTests();
    const setItem = localStorage.setItem.bind(localStorage);
    vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => {
      if (key.startsWith(QUARANTINE_PREFIX)) throw new Error("full");
      setItem(key, value);
    });
    expect(canSavePeopleDirectory()).toBe(false);
    expect(updatePeopleDirectory((directory) => ({ ...directory, people: [person("person_a", "A")] }))).toBeNull();
    expect(localStorage.getItem(PEOPLE_KEY)).toBe(raw);
  });

  it("round-trips people through a full backup and merges them on restore", () => {
    storePeople(person("person_alex", "Alex"));
    const backup = JSON.parse(JSON.stringify(buildBackup(null, [], new Date(NOW), loadPeopleDirectory()))) as unknown;
    localStorage.clear();
    storePeople(person("person_blair", "Blair"), person("person_alex_here", "alex"));

    const parsed = parseBackup(backup);
    expect(parsed?.people.people.map((entry) => entry.id)).toEqual(["person_alex"]);
    expect(mergeStoredPeople(parsed!.people)).toBe(true);
    const index = indexPeople(loadPeopleDirectory());
    expect([...index.byId.keys()].sort()).toEqual(["person_alex", "person_alex_here", "person_blair"]);
    // The restored namesake is linked to the person already here, and can be separated later.
    expect(index.rootId("person_alex")).toBe("person_alex_here");

    // Backups from before people existed still parse.
    const old = { ...(backup as object), people: undefined };
    expect(parseBackup(old)?.people.people).toEqual([]);
  });
});

describe("PlayerDrawer person linking", () => {
  const players = [
    { id: "p1", name: "Player 1", seatIndex: 0, isActive: true },
    { id: "p2", name: "Player 2", seatIndex: 1, isActive: true }
  ];

  it("links an exact name match when the name is committed", () => {
    storePeople(person("person_mike", "Michael", { aliases: ["Mike"] }));
    const dispatch = vi.fn();
    render(<PlayerDrawer dispatch={dispatch} fastEntryDisabled={false} players={players} readOnly={false} transactions={[]} />);
    const [first] = screen.getAllByRole("textbox", { name: "Player name" });
    fireEvent.focus(first);
    fireEvent.change(first, { target: { value: "mike" } });
    expect(screen.getByText("Player History: Michael")).toBeInTheDocument();
    fireEvent.blur(first);
    expect(dispatch).toHaveBeenCalledWith({ type: "rename_player", playerId: "p1", name: "mike", personId: "person_mike" });
  });

  it("offers known people and picks one", () => {
    storePeople(person("person_sam_a", "Sam"), person("person_sam_b", "Sam"), person("person_dana", "Dana"));
    const dispatch = vi.fn();
    render(<PlayerDrawer dispatch={dispatch} fastEntryDisabled={false} players={players} readOnly={false} transactions={[]} />);
    const [first] = screen.getAllByRole("textbox", { name: "Player name" });
    fireEvent.focus(first);
    fireEvent.change(first, { target: { value: "Sam" } });
    expect(screen.getByText("More than one person is called Sam. Pick one below.")).toBeInTheDocument();
    const picks = within(screen.getByRole("group", { name: "Known players" })).getAllByRole("button", { name: "Use Sam" });
    expect(picks).toHaveLength(2);
    fireEvent.click(picks[1]);
    expect(dispatch).toHaveBeenLastCalledWith({ type: "rename_player", playerId: "p1", name: "Sam", personId: "person_sam_b" });
    // Committing afterwards keeps the picked namesake instead of sending another change.
    fireEvent.blur(first);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});

describe("Player History merging", () => {
  async function renderHistory() {
    await mergeArchivedGames([legacy(["Mike", "Alex"], 1), legacy(["Michael"], 2), legacy(["mike"], 3)]);
    render(<SessionHistoryPanel />);
    await screen.findByText("3 archived games");
    fireEvent.click(screen.getByRole("button", { name: "Merge or rename" }));
  }

  it("merges legacy names into a person and separates them again", async () => {
    await renderHistory();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Michael" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select mike" }));
    expect(screen.getByLabelText("Merged name")).toHaveValue("mike");
    fireEvent.change(screen.getByLabelText("Merged name"), { target: { value: "Michael" } });
    fireEvent.click(screen.getByRole("button", { name: "Merge 2 players" }));

    expect(screen.getByRole("checkbox", { name: "Select Michael" }).closest(".history-stat-row")).toHaveTextContent("3 games");
    expect(screen.queryByRole("checkbox", { name: "Select mike" })).not.toBeInTheDocument();
    const people = loadPeopleDirectory();
    expect(people.people).toEqual([expect.objectContaining({ name: "Michael", aliases: ["mike"] })]);

    fireEvent.click(screen.getByRole("button", { name: "Separate mike from Michael" }));
    expect(screen.getByRole("checkbox", { name: "Select mike" }).closest(".history-stat-row")).toHaveTextContent("2 games");
  });

  it("renames a row, keeping its old name linked", async () => {
    await renderHistory();
    fireEvent.click(screen.getByRole("button", { name: "Rename Alex" }));
    fireEvent.change(screen.getByLabelText("New name for Alex"), { target: { value: "Alexandra" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("checkbox", { name: "Select Alexandra" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Rename Alexandra" }));
    fireEvent.change(screen.getByLabelText("New name for Alexandra"), { target: { value: "michael" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/merge them instead/);
    expect(screen.getByRole("checkbox", { name: "Select Alexandra" })).toBeInTheDocument();
  });

  it("updates when people change in another tab", async () => {
    await renderHistory();
    const directory: PeopleDirectory = {
      schemaVersion: 1,
      people: [person("person_m", "Mike", { aliases: ["Michael"] })]
    };
    act(() => {
      localStorage.setItem(PEOPLE_KEY, JSON.stringify(directory));
      window.dispatchEvent(new StorageEvent("storage", { key: PEOPLE_KEY }));
    });
    expect(screen.getByRole("checkbox", { name: "Select Mike" }).closest(".history-stat-row")).toHaveTextContent("3 games");
  });
});
