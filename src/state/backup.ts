import { EMPTY_PEOPLE_DIRECTORY, parsePeopleDirectory, type PeopleDirectory } from "../domain/people";
import type { GameState } from "../domain/pokerTypes";
import { parseArchivedGames, type ArchivedGame } from "../domain/sessionHistory";
import { validatePersistedState } from "../domain/validation";
import { recordBackupExport } from "./backupReminder";
import { loadArchivedGames } from "./gameArchive";
import { loadPeopleDirectory } from "./peopleStore";
import { migratePersistedState } from "./persistence";

export const BACKUP_FORMAT = "poker-tracker-backup";

/**
 * A full local backup: the current game, Player History, and the people
 * directory. Friend profiles are deliberately excluded because they carry an
 * owner secret. `people` is an additive optional field, so the format stays at
 * version 1: older builds ignore it and older backups simply lack it.
 */
export type BackupFile = {
  format: typeof BACKUP_FORMAT;
  version: 1;
  exportedAt: string;
  currentGame: GameState | null;
  archivedGames: ArchivedGame[];
  people?: PeopleDirectory;
};

export type ParsedBackup = {
  currentGame: GameState | null;
  archivedGames: ArchivedGame[];
  /** Empty when the backup has no (readable) people. */
  people: PeopleDirectory;
};

export function buildBackup(
  currentGame: GameState | null,
  archivedGames: ArchivedGame[],
  exportedAt = new Date(),
  people: PeopleDirectory = EMPTY_PEOPLE_DIRECTORY
): BackupFile {
  return {
    format: BACKUP_FORMAT,
    version: 1,
    exportedAt: exportedAt.toISOString(),
    currentGame,
    archivedGames,
    people
  };
}

export function parseBackup(value: unknown): ParsedBackup | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<Record<keyof BackupFile, unknown>>;
  if (candidate.format !== BACKUP_FORMAT || candidate.version !== 1) return null;
  const currentGame = validatePersistedState(candidate.currentGame)
    ? migratePersistedState(candidate.currentGame)
    : null;
  return {
    currentGame,
    archivedGames: parseArchivedGames(candidate.archivedGames),
    people: parsePeopleDirectory(candidate.people)?.directory ?? EMPTY_PEOPLE_DIRECTORY
  };
}

export function downloadJson(filename: string, value: unknown): void {
  downloadText(filename, JSON.stringify(value, null, 2));
}

export function downloadText(filename: string, text: string, type = "application/json"): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function exportFullBackup(currentGame: GameState | null, now = new Date()): Promise<void> {
  const backup = buildBackup(currentGame, await loadArchivedGames(), now, loadPeopleDirectory());
  downloadJson(`poker-tracker-backup-${backup.exportedAt.slice(0, 10)}.json`, backup);
  recordBackupExport(now.getTime());
}
