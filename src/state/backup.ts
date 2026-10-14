import type { GameState } from "../domain/pokerTypes";
import { parseArchivedGames, type ArchivedGame } from "../domain/sessionHistory";
import { validatePersistedState } from "../domain/validation";
import { recordBackupExport } from "./backupReminder";
import { loadArchivedGames } from "./gameArchive";
import { migratePersistedState } from "./persistence";

export const BACKUP_FORMAT = "poker-tracker-backup";

/**
 * A full local backup: the current game plus Player History. Friend profiles are
 * deliberately excluded because they carry an owner secret.
 */
export type BackupFile = {
  format: typeof BACKUP_FORMAT;
  version: 1;
  exportedAt: string;
  currentGame: GameState | null;
  archivedGames: ArchivedGame[];
};

export function buildBackup(
  currentGame: GameState | null,
  archivedGames: ArchivedGame[],
  exportedAt = new Date()
): BackupFile {
  return {
    format: BACKUP_FORMAT,
    version: 1,
    exportedAt: exportedAt.toISOString(),
    currentGame,
    archivedGames
  };
}

export function parseBackup(
  value: unknown
): { currentGame: GameState | null; archivedGames: ArchivedGame[] } | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<Record<keyof BackupFile, unknown>>;
  if (candidate.format !== BACKUP_FORMAT || candidate.version !== 1) return null;
  const currentGame = validatePersistedState(candidate.currentGame)
    ? migratePersistedState(candidate.currentGame)
    : null;
  return { currentGame, archivedGames: parseArchivedGames(candidate.archivedGames) };
}

export function downloadJson(filename: string, value: unknown): void {
  downloadText(filename, JSON.stringify(value, null, 2));
}

export function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function exportFullBackup(currentGame: GameState | null, now = new Date()): Promise<void> {
  const backup = buildBackup(currentGame, await loadArchivedGames(), now);
  downloadJson(`poker-tracker-backup-${backup.exportedAt.slice(0, 10)}.json`, backup);
  recordBackupExport(now.getTime());
}
