import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionHistoryPanel } from "../components/SessionHistoryPanel";
import { StorageRecoveryNotice } from "../components/StorageRecoveryNotice";
import type { ArchivedGame } from "../domain/sessionHistory";
import {
  ARCHIVE_CHANNEL_NAME,
  GAME_ARCHIVE_CHANGED_EVENT,
  GAME_ARCHIVE_KEY,
  MAX_ARCHIVED_GAMES,
  archiveGame,
  getArchiveBackend,
  hasArchivedGames,
  loadArchivedGames,
  mergeArchivedGames,
  peekArchivedGames,
  resetGameArchiveForTests
} from "../state/gameArchive";
import { openArchiveDb, readArchiveRecords, type ArchiveRecord } from "../state/gameArchiveIdb";
import { createDefaultGameState } from "../state/seedGame";
import { clearUnsavedQuarantineCopies, listQuarantined } from "../state/storageQuarantine";

function playedGame(name: string) {
  const state = createDefaultGameState();
  state.settings.gameName = name;
  state.transactions.push({
    id: `buy-${name}`,
    type: "bank_buy_in",
    toPlayerId: state.players[0].id,
    amountCents: 2000,
    createdAt: "2026-10-01T00:00:00Z"
  });
  return state;
}

function archived(name: string, day: number): ArchivedGame {
  return { archivedAt: new Date(Date.UTC(2026, 0, day)).toISOString(), state: playedGame(name) };
}

const names = (games: ArchivedGame[]) => games.map((game) => game.state.settings.gameName);

async function storedRecords(): Promise<ArchiveRecord[]> {
  const db = await openArchiveDb(indexedDB, 1000);
  try {
    return await readArchiveRecords(db);
  } finally {
    db.close();
  }
}

/** Simulates a page reload: same IndexedDB, fresh module state. */
function reload() {
  resetGameArchiveForTests();
}

beforeEach(() => {
  localStorage.clear();
  clearUnsavedQuarantineCopies();
});
afterEach(() => vi.restoreAllMocks());

describe("Player History in IndexedDB", () => {
  it("stores one record per game, newest first", async () => {
    expect(await getArchiveBackend()).toBe("indexeddb");
    const [older, newer] = [archived("Older", 1), archived("Newer", 2)];
    expect(await mergeArchivedGames([older, newer])).toBe(true);
    expect(await archiveGame(playedGame("Tonight"))).toBe(true);

    expect(names(await loadArchivedGames())).toEqual(["Tonight", "Newer", "Older"]);
    const records = await storedRecords();
    expect(records.map((record) => record.id)).toContain(older.state.localGameId);
    expect(records).toHaveLength(3);
    expect(localStorage.getItem(GAME_ARCHIVE_KEY)).toBeNull();
    expect(await hasArchivedGames()).toBe(true);
  });

  it("re-archiving replaces a game, while restores keep the newest copy", async () => {
    const game = archived("Friday", 5);
    await mergeArchivedGames([game]);
    await mergeArchivedGames([{ ...game, archivedAt: archived("x", 1).archivedAt, state: { ...game.state, transactions: [] } }]);
    expect((await loadArchivedGames())[0].state.transactions).toHaveLength(1);

    const replayed = { ...game.state, settings: { ...game.state.settings, gameName: "Friday again" } };
    await archiveGame(replayed);
    expect(names(await loadArchivedGames())).toEqual(["Friday again"]);
  });

  it(`keeps the newest ${MAX_ARCHIVED_GAMES} readable games`, async () => {
    const games = Array.from({ length: MAX_ARCHIVED_GAMES + 3 }, (_, index) => archived(`Game ${index}`, index + 1));
    expect(await mergeArchivedGames(games)).toBe(true);
    const loaded = await loadArchivedGames();
    expect(loaded).toHaveLength(MAX_ARCHIVED_GAMES);
    expect(loaded[0].state.settings.gameName).toBe(`Game ${MAX_ARCHIVED_GAMES + 2}`);
    expect(names(loaded)).not.toContain("Game 2");
  });

  it("caches parsed games until the archive changes", async () => {
    await mergeArchivedGames([archived("One", 1)]);
    const first = await loadArchivedGames();
    expect(await loadArchivedGames()).toBe(first);
    expect(peekArchivedGames()).toBe(first);

    const changed = vi.fn();
    window.addEventListener(GAME_ARCHIVE_CHANGED_EVENT, changed);
    await archiveGame(playedGame("Two"));
    window.removeEventListener(GAME_ARCHIVE_CHANGED_EVENT, changed);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(peekArchivedGames()).toBeUndefined();

    const second = await loadArchivedGames();
    expect(names(second)).toEqual(["Two", "One"]);
    // The unchanged record was not parsed again.
    expect(second[1]).toBe(first[0]);
  });

  it("refreshes when another tab announces a change", async () => {
    await loadArchivedGames();
    const otherTab = new BroadcastChannel(ARCHIVE_CHANNEL_NAME);
    const received = new Promise((resolve) => { otherTab.onmessage = resolve; });
    await archiveGame(playedGame("Here"));
    await received;

    const changed = new Promise((resolve) => window.addEventListener(GAME_ARCHIVE_CHANGED_EVENT, resolve, { once: true }));
    await loadArchivedGames();
    otherTab.postMessage("changed");
    await changed;
    otherTab.close();
    expect(peekArchivedGames()).toBeUndefined();
  });

  it("keeps an unreadable record when a game with the same id is archived", async () => {
    const state = playedGame("Tonight");
    const future = { archivedAt: "2026-10-02T00:00:00.000Z", state: { ...state, schemaVersion: 99 } };
    localStorage.setItem(GAME_ARCHIVE_KEY, JSON.stringify([future]));
    expect(await loadArchivedGames()).toEqual([]);

    expect(await archiveGame(state)).toBe(true);
    const records = await storedRecords();
    expect(records).toHaveLength(2);
    expect(records.map((record) => record.entry)).toContainEqual(future);
    expect(names(await loadArchivedGames())).toEqual(["Tonight"]);
  });
});

describe("moving the localStorage archive", () => {
  it("migrates once and survives a crash before the old key was removed", async () => {
    const legacy = [archived("Two", 2), archived("One", 1)];
    const raw = JSON.stringify(legacy);
    localStorage.setItem(GAME_ARCHIVE_KEY, raw);
    expect(names(await loadArchivedGames())).toEqual(["Two", "One"]);
    expect(localStorage.getItem(GAME_ARCHIVE_KEY)).toBeNull();

    // A newer copy of "One" is archived, then the old key reappears as if the
    // previous run stopped after the IndexedDB commit but before removing it.
    await archiveGame({ ...legacy[1].state, settings: { ...legacy[1].state.settings, gameName: "One replayed" } });
    localStorage.setItem(GAME_ARCHIVE_KEY, raw);
    reload();

    expect(names(await loadArchivedGames())).toEqual(["One replayed", "Two"]);
    expect(await storedRecords()).toHaveLength(2);
    expect(localStorage.getItem(GAME_ARCHIVE_KEY)).toBeNull();
  });

  it("keeps the old key when the IndexedDB write fails and uses it for the session", async () => {
    const raw = JSON.stringify([archived("Kept", 1)]);
    localStorage.setItem(GAME_ARCHIVE_KEY, raw);
    const put = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });

    expect(names(await loadArchivedGames())).toEqual(["Kept"]);
    expect(await getArchiveBackend()).toBe("localStorage");
    expect(localStorage.getItem(GAME_ARCHIVE_KEY)).toBe(raw);
    expect(await storedRecords()).toHaveLength(0);

    put.mockRestore();
    reload();
    expect(names(await loadArchivedGames())).toEqual(["Kept"]);
    expect(localStorage.getItem(GAME_ARCHIVE_KEY)).toBeNull();
  });

  it("stores invalid entries as records and keeps one copy for the user", async () => {
    const valid = archived("Valid", 1);
    const future = { archivedAt: "2026-10-02T00:00:00.000Z", state: { ...playedGame("Future"), schemaVersion: 99 } };
    const garbage = { archivedAt: 42 };
    localStorage.setItem(GAME_ARCHIVE_KEY, JSON.stringify([future, valid, garbage]));
    render(<StorageRecoveryNotice />);

    expect(names(await act(() => loadArchivedGames()))).toEqual(["Valid"]);
    expect(await screen.findByText(/2 games in Player History couldn't be read/)).toBeInTheDocument();
    const entries = (await storedRecords()).map((record) => record.entry);
    expect(entries).toHaveLength(3);
    expect(entries).toContainEqual(future);
    expect(entries).toContainEqual(garbage);

    reload();
    localStorage.setItem(GAME_ARCHIVE_KEY, JSON.stringify([future, valid, garbage]));
    await act(() => loadArchivedGames());
    expect(await storedRecords()).toHaveLength(3);
    expect(listQuarantined()).toHaveLength(1);
  });

  it("picks up the old key written later by an older build in another tab", async () => {
    await archiveGame(playedGame("New build"));
    await loadArchivedGames();
    localStorage.setItem(GAME_ARCHIVE_KEY, JSON.stringify([archived("Old build", 1)]));
    const changed = new Promise((resolve) => window.addEventListener(GAME_ARCHIVE_CHANGED_EVENT, resolve, { once: true }));
    window.dispatchEvent(new StorageEvent("storage", { key: GAME_ARCHIVE_KEY }));
    await changed;

    expect(names(await loadArchivedGames())).toEqual(["New build", "Old build"]);
    expect(localStorage.getItem(GAME_ARCHIVE_KEY)).toBeNull();
  });
});

describe("without a usable IndexedDB", () => {
  it("falls back to localStorage when IndexedDB is missing", async () => {
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, writable: true, value: undefined });
    expect(await getArchiveBackend()).toBe("localStorage");
    expect(await archiveGame(playedGame("Private"))).toBe(true);
    expect(JSON.parse(localStorage.getItem(GAME_ARCHIVE_KEY) ?? "[]")).toHaveLength(1);
    expect(names(await loadArchivedGames())).toEqual(["Private"]);
    expect(await hasArchivedGames()).toBe(true);
  });

  it("falls back to localStorage when IndexedDB fails to open", async () => {
    vi.spyOn(indexedDB, "open").mockImplementation(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });
    localStorage.setItem(GAME_ARCHIVE_KEY, JSON.stringify([archived("Saved", 1)]));
    expect(await getArchiveBackend()).toBe("localStorage");
    expect(await mergeArchivedGames([archived("Restored", 2)])).toBe(true);
    expect(names(await loadArchivedGames())).toEqual(["Restored", "Saved"]);
  });
});

describe("SessionHistoryPanel", () => {
  it("shows a loading state, then the archived games", async () => {
    await mergeArchivedGames([archived("Friday", 1)]);
    reload();
    render(<SessionHistoryPanel />);
    expect(screen.getByText("Loading Player History…")).toBeInTheDocument();
    expect(await screen.findByText("1 archived game")).toBeInTheDocument();

    await archiveGame(playedGame("Saturday"));
    expect(await screen.findByText("2 archived games")).toBeInTheDocument();
  });
});
