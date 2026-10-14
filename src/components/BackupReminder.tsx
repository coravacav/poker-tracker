import { DatabaseBackup } from "lucide-react";
import { useState } from "react";
import type { GameState } from "../domain/pokerTypes";
import { loadArchivedGames } from "../domain/sessionHistory";
import { exportFullBackup } from "../state/backup";
import {
  dismissBackupReminder,
  readBackupReminderDismissedUntil,
  readLastBackupExportAt,
  shouldShowBackupReminder
} from "../state/backupReminder";
import { useStoragePersistenceStatus } from "../state/useStoragePersistence";

export function BackupReminder({ currentGame }: { currentGame: GameState | null }) {
  const persistence = useStoragePersistenceStatus();
  const [archivedGames] = useState(loadArchivedGames);
  const [hidden, setHidden] = useState(false);

  if (
    hidden ||
    !shouldShowBackupReminder({
      persistence,
      archivedGames,
      lastExportedAt: readLastBackupExportAt(),
      dismissedUntil: readBackupReminderDismissedUntil(),
      now: Date.now()
    })
  ) {
    return null;
  }

  const count = archivedGames.length;
  return (
    <section className="backup-reminder" aria-label="Backup reminder">
      <DatabaseBackup size={20} aria-hidden="true" />
      <div className="backup-reminder-copy">
        <strong>Back up your poker history</strong>
        <p>
          Your {count} archived {count === 1 ? "game is" : "games are"} saved only in this browser,
          which may clear site data that goes unused for a while. Download a backup file to keep a copy.
        </p>
      </div>
      <div className="backup-reminder-actions">
        <button
          className="primary-button"
          type="button"
          onClick={() => {
            exportFullBackup(currentGame);
            setHidden(true);
          }}
        >
          Back up now
        </button>
        <button
          className="text-button"
          type="button"
          onClick={() => {
            dismissBackupReminder();
            setHidden(true);
          }}
        >
          Remind me later
        </button>
      </div>
    </section>
  );
}
