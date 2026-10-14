import type { StoragePersistenceStatus } from "./storagePersistence";

export const LAST_BACKUP_EXPORT_KEY = "poker-tracker:v1:last-backup-export-at";
export const BACKUP_REMINDER_DISMISSED_UNTIL_KEY = "poker-tracker:v1:backup-reminder-dismissed-until";
const DAY_MS = 24 * 60 * 60 * 1000;
/** "Remind me later" hides the reminder for this long. */
export const BACKUP_REMINDER_SNOOZE_MS = 14 * DAY_MS;
/** A backup newer than this counts as recent even if games were archived since. */
export const BACKUP_STALE_MS = 30 * DAY_MS;

export type BackupReminderInput = {
  persistence: StoragePersistenceStatus | "unknown";
  archivedGames: Array<{ archivedAt: string }>;
  lastExportedAt: number | null;
  dismissedUntil: number | null;
  now: number;
};

export function shouldShowBackupReminder({
  persistence,
  archivedGames,
  lastExportedAt,
  dismissedUntil,
  now
}: BackupReminderInput): boolean {
  if (persistence === "granted" || persistence === "unknown") return false;
  if (archivedGames.length === 0) return false;
  if (dismissedUntil !== null && now < dismissedUntil) return false;
  if (lastExportedAt === null) return true;
  if (now - lastExportedAt < BACKUP_STALE_MS) return false;
  const newestArchivedAt = Math.max(...archivedGames.map((game) => Date.parse(game.archivedAt) || 0));
  return newestArchivedAt > lastExportedAt;
}

function readTimestamp(key: string): number | null {
  try {
    const value = Number(localStorage.getItem(key));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function writeTimestamp(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Reminder bookkeeping is best-effort.
  }
}

export const readLastBackupExportAt = () => readTimestamp(LAST_BACKUP_EXPORT_KEY);
export const readBackupReminderDismissedUntil = () => readTimestamp(BACKUP_REMINDER_DISMISSED_UNTIL_KEY);
export const recordBackupExport = (now = Date.now()) => writeTimestamp(LAST_BACKUP_EXPORT_KEY, now);
export const dismissBackupReminder = (now = Date.now()) =>
  writeTimestamp(BACKUP_REMINDER_DISMISSED_UNTIL_KEY, now + BACKUP_REMINDER_SNOOZE_MS);
