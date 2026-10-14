import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackupReminder } from "../components/BackupReminder";
import { archiveGame, loadArchivedGames } from "../state/gameArchive";
import { buildBackup, parseBackup } from "../state/backup";
import {
  BACKUP_REMINDER_DISMISSED_UNTIL_KEY,
  BACKUP_REMINDER_SNOOZE_MS,
  BACKUP_STALE_MS,
  LAST_BACKUP_EXPORT_KEY,
  shouldShowBackupReminder,
  type BackupReminderInput
} from "../state/backupReminder";
import { createDefaultGameState } from "../state/seedGame";

const NOW = Date.parse("2026-10-14T12:00:00Z");
const games = [{ archivedAt: "2026-10-01T00:00:00Z" }];

function input(overrides: Partial<BackupReminderInput> = {}): BackupReminderInput {
  return {
    persistence: "not_granted",
    archivedGames: games,
    lastExportedAt: null,
    dismissedUntil: null,
    now: NOW,
    ...overrides
  };
}

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

describe("backup reminder visibility", () => {
  it("shows when storage is not persistent and history has never been exported", () => {
    expect(shouldShowBackupReminder(input())).toBe(true);
    expect(shouldShowBackupReminder(input({ persistence: "unsupported" }))).toBe(true);
  });

  it("stays hidden when persistence is granted or still being checked", () => {
    expect(shouldShowBackupReminder(input({ persistence: "granted" }))).toBe(false);
    expect(shouldShowBackupReminder(input({ persistence: "unknown" }))).toBe(false);
  });

  it("stays hidden without archived history", () => {
    expect(shouldShowBackupReminder(input({ archivedGames: [] }))).toBe(false);
  });

  it("respects a snooze", () => {
    expect(shouldShowBackupReminder(input({ dismissedUntil: NOW + 1 }))).toBe(false);
    expect(shouldShowBackupReminder(input({ dismissedUntil: NOW }))).toBe(true);
  });

  it("stays hidden after a recent backup", () => {
    expect(shouldShowBackupReminder(input({ lastExportedAt: NOW - BACKUP_STALE_MS + 1 }))).toBe(false);
  });

  it("returns after an old backup only when newer games were archived", () => {
    const lastExportedAt = NOW - BACKUP_STALE_MS;
    expect(shouldShowBackupReminder(input({
      lastExportedAt,
      archivedGames: [{ archivedAt: new Date(lastExportedAt - 1).toISOString() }]
    }))).toBe(false);
    expect(shouldShowBackupReminder(input({
      lastExportedAt,
      archivedGames: [{ archivedAt: new Date(lastExportedAt + 1).toISOString() }]
    }))).toBe(true);
  });
});

describe("full backup file", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips the current game and archive and rejects other JSON", () => {
    const archived = { archivedAt: "2026-10-01T00:00:00.000Z", state: playedGame("Old") };
    const current = playedGame("Current");
    const parsed = parseBackup(JSON.parse(JSON.stringify(buildBackup(current, [archived]))));
    expect(parsed?.currentGame?.localGameId).toBe(current.localGameId);
    expect(parsed?.archivedGames.map((game) => game.state.localGameId)).toEqual([archived.state.localGameId]);
    expect(parseBackup(current)).toBeNull();
    expect(parseBackup(null)).toBeNull();
  });
});

describe("BackupReminder", () => {
  beforeEach(() => {
    localStorage.clear();
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:backup"), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("is hidden without archived games", async () => {
    render(<BackupReminder currentGame={null} />);
    expect(screen.queryByRole("region", { name: "Backup reminder" })).not.toBeInTheDocument();
  });

  it("exports a backup and records the time", async () => {
    await archiveGame(playedGame("Friday"));
    render(<BackupReminder currentGame={null} />);
    const button = await screen.findByRole("button", { name: "Back up now" });
    expect(screen.getByText(/Your 1 archived game is saved only in this browser/)).toBeInTheDocument();
    fireEvent.click(button);
    await waitFor(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled());
    expect(Number(localStorage.getItem(LAST_BACKUP_EXPORT_KEY))).toBeGreaterThan(0);
    expect(screen.queryByRole("region", { name: "Backup reminder" })).not.toBeInTheDocument();
  });

  it("can be snoozed for two weeks", async () => {
    await archiveGame(playedGame("Friday"));
    render(<BackupReminder currentGame={null} />);
    fireEvent.click(await screen.findByRole("button", { name: "Remind me later" }));
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Backup reminder" })).not.toBeInTheDocument()
    );
    const dismissedUntil = Number(localStorage.getItem(BACKUP_REMINDER_DISMISSED_UNTIL_KEY));
    expect(dismissedUntil - Date.now()).toBeGreaterThan(BACKUP_REMINDER_SNOOZE_MS - 60_000);
  });

  it("stays hidden when the browser has granted persistent storage", async () => {
    await archiveGame(playedGame("Friday"));
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: { persisted: async () => true, persist: async () => true }
    });
    try {
      await act(async () => {
        render(<BackupReminder currentGame={null} />);
      });
      expect(screen.queryByRole("region", { name: "Backup reminder" })).not.toBeInTheDocument();
      expect(await loadArchivedGames()).toHaveLength(1);
    } finally {
      Reflect.deleteProperty(navigator, "storage");
    }
  });
});
