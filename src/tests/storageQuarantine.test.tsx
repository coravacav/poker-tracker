import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StorageRecoveryNotice } from "../components/StorageRecoveryNotice";
import { FRIEND_PROFILE_KEY, loadFriendProfile } from "../session/friendProfiles";
import { parseBackup } from "../state/backup";
import { archiveGame, GAME_ARCHIVE_KEY, loadArchivedGames } from "../state/gameArchive";
import { openArchiveDb, readArchiveRecords } from "../state/gameArchiveIdb";
import { loadGameState, loadSavedGameState, saveGameState, STORAGE_KEY } from "../state/persistence";
import { createDefaultGameState } from "../state/seedGame";
import {
  MAX_COPIES_PER_SOURCE,
  QUARANTINE_PREFIX,
  clearUnsavedQuarantineCopies,
  deleteQuarantined,
  listQuarantined,
  quarantineRaw
} from "../state/storageQuarantine";

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

function newerVersionGame(name: string) {
  return { ...playedGame(name), schemaVersion: 9, someFutureField: { nested: true } };
}

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

/** Makes writes of quarantine copies fail as if storage were full. */
function failQuarantineWrites() {
  const original = localStorage.setItem.bind(localStorage);
  return vi.spyOn(localStorage, "setItem").mockImplementation((key: string, value: string) => {
    if (key.startsWith(QUARANTINE_PREFIX)) {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    }
    original(key, value);
  });
}

beforeEach(() => {
  localStorage.clear();
  clearUnsavedQuarantineCopies();
});
afterEach(() => vi.restoreAllMocks());

describe("current game quarantine", () => {
  it("keeps unparseable JSON before a fresh game overwrites it", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    const fresh = loadGameState();
    saveGameState(fresh);

    const [copy] = listQuarantined();
    expect(copy).toMatchObject({ sourceKey: STORAGE_KEY, reason: "unreadable", raw: "{not json", persisted: true });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null").localGameId).toBe(fresh.localGameId);
  });

  it("keeps a value with an invalid shape", () => {
    const raw = JSON.stringify({ schemaVersion: 7, players: "nope" });
    localStorage.setItem(STORAGE_KEY, raw);
    expect(loadSavedGameState()).toBeNull();
    expect(listQuarantined()).toEqual([expect.objectContaining({ reason: "invalid", raw })]);
  });

  it("flags a save from a newer schema version and leaves it in place", () => {
    const raw = JSON.stringify(newerVersionGame("Future"));
    localStorage.setItem(STORAGE_KEY, raw);
    expect(loadSavedGameState()).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBe(raw);
    expect(listQuarantined()).toEqual([expect.objectContaining({ reason: "newer_version", raw })]);
  });

  it("does not keep the same value twice and respects deletion", () => {
    localStorage.setItem(STORAGE_KEY, "{broken");
    loadSavedGameState();
    loadSavedGameState();
    loadGameState();
    expect(listQuarantined()).toHaveLength(1);

    deleteQuarantined(listQuarantined()[0].id);
    loadSavedGameState();
    expect(listQuarantined()).toHaveLength(0);

    localStorage.setItem(STORAGE_KEY, "{broken differently");
    loadSavedGameState();
    expect(listQuarantined()).toHaveLength(1);
  });

  it("keeps a bounded number of copies per source", () => {
    for (let index = 0; index < MAX_COPIES_PER_SOURCE + 2; index += 1) {
      quarantineRaw(STORAGE_KEY, `{bad ${index}`, "unreadable", { now: new Date(Date.UTC(2026, 0, index + 1)) });
    }
    const copies = listQuarantined();
    expect(copies).toHaveLength(MAX_COPIES_PER_SOURCE);
    expect(copies[0].raw).toBe(`{bad ${MAX_COPIES_PER_SOURCE + 1}`);
  });

  it("releases a copy once the same stored value reads cleanly", () => {
    const raw = JSON.stringify(playedGame("Now readable"));
    quarantineRaw(STORAGE_KEY, raw, "newer_version");
    localStorage.setItem(STORAGE_KEY, raw);
    expect(loadSavedGameState()?.settings.gameName).toBe("Now readable");
    expect(listQuarantined()).toHaveLength(0);
  });

  it("keeps the copy in memory when storage is full", () => {
    failQuarantineWrites();
    localStorage.setItem(STORAGE_KEY, "{not json");
    expect(loadSavedGameState()).toBeNull();
    expect(loadSavedGameState()).toBeNull();
    expect(listQuarantined()).toEqual([
      expect.objectContaining({ raw: "{not json", persisted: false })
    ]);
  });
});

async function storedArchiveEntries(): Promise<unknown[]> {
  const db = await openArchiveDb(indexedDB, 1000);
  try {
    return (await readArchiveRecords(db)).map((record) => record.entry);
  } finally {
    db.close();
  }
}

describe("game archive quarantine", () => {
  it("keeps invalid entries when moving the archive to IndexedDB", async () => {
    const valid = { archivedAt: "2026-10-01T00:00:00.000Z", state: playedGame("Valid") };
    const future = { archivedAt: "2026-10-02T00:00:00.000Z", state: newerVersionGame("Future") };
    const garbage = { archivedAt: 42 };
    localStorage.setItem(GAME_ARCHIVE_KEY, JSON.stringify([future, valid, garbage]));

    expect((await loadArchivedGames()).map((game) => game.state.settings.gameName)).toEqual(["Valid"]);
    expect(localStorage.getItem(GAME_ARCHIVE_KEY)).toBeNull();
    const copies = listQuarantined();
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({ sourceKey: GAME_ARCHIVE_KEY, scope: "entries", entryCount: 2, reason: "invalid" });
    expect(JSON.parse(copies[0].raw)).toEqual(expect.arrayContaining([future, garbage]));

    expect(await archiveGame(playedGame("Tonight"))).toBe(true);
    const stored = await storedArchiveEntries();
    expect(stored).toHaveLength(4);
    expect(stored).toContainEqual(future);
    expect(stored).toContainEqual(garbage);
    expect((await loadArchivedGames()).map((game) => game.state.settings.gameName)).toEqual(["Tonight", "Valid"]);
    expect(listQuarantined()).toHaveLength(1);
  });

  it("labels entries that all come from a newer version", async () => {
    const future = { archivedAt: "2026-10-02T00:00:00.000Z", state: newerVersionGame("Future") };
    localStorage.setItem(GAME_ARCHIVE_KEY, JSON.stringify([future]));
    expect(await loadArchivedGames()).toEqual([]);
    expect(listQuarantined()[0]).toMatchObject({ reason: "newer_version", entryCount: 1 });
  });

  it("keeps an unreadable archive before dropping it", async () => {
    localStorage.setItem(GAME_ARCHIVE_KEY, "[{truncated");
    expect(await archiveGame(playedGame("Tonight"))).toBe(true);
    expect(listQuarantined()).toEqual([
      expect.objectContaining({ sourceKey: GAME_ARCHIVE_KEY, scope: "value", raw: "[{truncated" })
    ]);
    expect(localStorage.getItem(GAME_ARCHIVE_KEY)).toBeNull();
    expect(await loadArchivedGames()).toHaveLength(1);
  });

  it("leaves an unreadable archive in place when no copy can be kept", async () => {
    failQuarantineWrites();
    localStorage.setItem(GAME_ARCHIVE_KEY, "[{truncated");
    expect(await archiveGame(playedGame("Tonight"))).toBe(true);
    expect(localStorage.getItem(GAME_ARCHIVE_KEY)).toBe("[{truncated");
    expect(listQuarantined()).toEqual([expect.objectContaining({ raw: "[{truncated", persisted: false })]);
  });

  describe("without IndexedDB", () => {
    beforeEach(() => {
      Object.defineProperty(globalThis, "indexedDB", { configurable: true, writable: true, value: undefined });
    });

    it("keeps invalid entries and writes them back", async () => {
      const valid = { archivedAt: "2026-10-01T00:00:00.000Z", state: playedGame("Valid") };
      const future = { archivedAt: "2026-10-02T00:00:00.000Z", state: newerVersionGame("Future") };
      const garbage = { archivedAt: 42 };
      localStorage.setItem(GAME_ARCHIVE_KEY, JSON.stringify([future, valid, garbage]));

      expect((await loadArchivedGames()).map((game) => game.state.settings.gameName)).toEqual(["Valid"]);
      expect(listQuarantined()[0]).toMatchObject({ scope: "entries", entryCount: 2 });
      expect(JSON.parse(listQuarantined()[0].raw)).toEqual([future, garbage]);

      expect(await archiveGame(playedGame("Tonight"))).toBe(true);
      const stored = JSON.parse(localStorage.getItem(GAME_ARCHIVE_KEY) ?? "[]") as unknown[];
      expect(stored).toHaveLength(4);
      expect(stored).toContainEqual(future);
      expect(stored).toContainEqual(garbage);
      expect(listQuarantined()).toHaveLength(1);
    });

    it("refuses to replace an unreadable archive when no copy can be kept", async () => {
      failQuarantineWrites();
      localStorage.setItem(GAME_ARCHIVE_KEY, "[{truncated");
      expect(await archiveGame(playedGame("Tonight"))).toBe(false);
      expect(localStorage.getItem(GAME_ARCHIVE_KEY)).toBe("[{truncated");
    });
  });
});

describe("other stored data", () => {
  it("keeps an unreadable friend profile, which holds an unrecoverable secret", () => {
    const raw = JSON.stringify({ schemaVersion: 2, friendCode: "2345ABCDEFGHJKLMNPQR", ownerSecret: "x".repeat(40) });
    localStorage.setItem(FRIEND_PROFILE_KEY, raw);
    expect(loadFriendProfile()).toBeNull();
    expect(listQuarantined()).toEqual([expect.objectContaining({ sourceKey: FRIEND_PROFILE_KEY, reason: "newer_version", raw })]);
  });
});

describe("StorageRecoveryNotice", () => {
  beforeEach(() => {
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:copy"), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  });

  it("is hidden when nothing was kept", () => {
    render(<StorageRecoveryNotice />);
    expect(screen.queryByRole("region", { name: "Unreadable saved data" })).not.toBeInTheDocument();
  });

  it("explains a newer-version save, downloads it, and deletes it", async () => {
    const raw = JSON.stringify(newerVersionGame("Future"));
    localStorage.setItem(STORAGE_KEY, raw);
    loadSavedGameState();
    render(<StorageRecoveryNotice />);

    expect(await screen.findByText("Saved by a newer version")).toBeInTheDocument();
    expect(screen.getByText(/Your saved game was saved by a newer version of Poker Tracker/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Download copy" }));
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
    expect(await readBlob(blob)).toBe(raw);

    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Delete copy" }));
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Unreadable saved data" })).not.toBeInTheDocument()
    );
    expect(listQuarantined()).toHaveLength(0);
  });

  it("downloads skipped history entries as an importable backup", async () => {
    const future = { archivedAt: "2026-10-02T00:00:00.000Z", state: playedGame("Future") };
    quarantineRaw(GAME_ARCHIVE_KEY, JSON.stringify([future]), "newer_version", { scope: "entries", entryCount: 1 });
    render(<StorageRecoveryNotice />);
    expect(await screen.findByText(/1 game in Player History was saved by a newer version/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Download copy" }));
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
    const parsed = parseBackup(JSON.parse(await readBlob(blob)));
    expect(parsed?.archivedGames.map((game) => game.state.settings.gameName)).toEqual(["Future"]);
  });

  it("warns when the copy could not be stored", async () => {
    failQuarantineWrites();
    localStorage.setItem(STORAGE_KEY, "{not json");
    loadSavedGameState();
    render(<StorageRecoveryNotice />);
    expect(await screen.findByText(/out of storage space/)).toBeInTheDocument();
  });
});
