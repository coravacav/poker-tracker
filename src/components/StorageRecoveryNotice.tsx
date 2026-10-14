import { FileWarning } from "lucide-react";
import { useEffect, useState } from "react";
import { FOLLOWED_FRIENDS_KEY, FRIEND_PROFILE_KEY } from "../session/friendProfiles";
import { HOST_RECOVERY_KEY, ROOM_HISTORY_KEY } from "../session/sessionPersistence";
import { BACKUP_FORMAT, downloadText } from "../state/backup";
import { GAME_ARCHIVE_KEY } from "../state/gameArchive";
import { PEOPLE_KEY } from "../state/peopleStore";
import { STORAGE_KEY } from "../state/persistence";
import {
  QUARANTINE_CHANGED_EVENT,
  deleteQuarantined,
  listQuarantined,
  type QuarantineRecord
} from "../state/storageQuarantine";

const SUBJECTS: Record<string, { value: string; entry: [string, string] }> = {
  [STORAGE_KEY]: { value: "Your saved game", entry: ["saved game", "saved games"] },
  [GAME_ARCHIVE_KEY]: { value: "Your Player History", entry: ["game in Player History", "games in Player History"] },
  [FRIEND_PROFILE_KEY]: { value: "Your friend profile", entry: ["friend profile", "friend profiles"] },
  [FOLLOWED_FRIENDS_KEY]: { value: "Your followed friends", entry: ["followed friend", "followed friends"] },
  [HOST_RECOVERY_KEY]: { value: "Your hosted room details", entry: ["hosted room", "hosted rooms"] },
  [ROOM_HISTORY_KEY]: { value: "Your room history", entry: ["room history entry", "room history entries"] },
  [PEOPLE_KEY]: { value: "Your people list", entry: ["person in your people list", "people in your people list"] }
};
const IMPORTABLE = new Set([STORAGE_KEY, GAME_ARCHIVE_KEY, PEOPLE_KEY]);

/** Wraps kept Player History entries or people as a backup file so a newer build can import them. */
function asBackup(record: QuarantineRecord): string | null {
  try {
    const value = JSON.parse(record.raw) as unknown;
    let archivedGames: unknown = [];
    let people: unknown;
    if (record.sourceKey === GAME_ARCHIVE_KEY && record.scope === "entries") {
      archivedGames = value;
    } else if (record.sourceKey === PEOPLE_KEY) {
      people = record.scope === "entries" ? { schemaVersion: 1, people: value } : value;
    } else {
      return null;
    }
    const backup = {
      format: BACKUP_FORMAT,
      version: 1,
      exportedAt: new Date().toISOString(),
      currentGame: null,
      archivedGames,
      ...(people === undefined ? {} : { people })
    };
    return JSON.stringify(backup, null, 2);
  } catch {
    return null;
  }
}

function describe(record: QuarantineRecord): { title: string; body: string } {
  const subject = SUBJECTS[record.sourceKey] ?? { value: "Some saved data", entry: ["item", "items"] };
  const count = record.entryCount ?? 1;
  const plural = record.scope === "entries" && count !== 1;
  const what = record.scope === "entries"
    ? `${count} ${plural ? subject.entry[1] : subject.entry[0]}`
    : subject.value;
  const restoreHint = IMPORTABLE.has(record.sourceKey)
    ? " If it's still missing after updating, download the copy and import it."
    : "";
  const fragile = record.persisted
    ? ""
    : " This device is out of storage space, so the copy only lasts until the app is closed. Download it now.";

  if (record.reason === "newer_version") {
    return {
      title: "Saved by a newer version",
      body: `${what} ${plural ? "were" : "was"} saved by a newer version of Poker Tracker, so this version can't open ${plural ? "them" : "it"}. A copy has been kept. Reload or update the app to open ${plural ? "them" : "it"}.${restoreHint}${fragile}`
    };
  }
  return {
    title: "Saved data couldn't be read",
    body: `${what} couldn't be read, so a copy has been kept instead of being overwritten. Download it to keep it safe.${fragile}`
  };
}

function downloadRecord(record: QuarantineRecord): void {
  const name = record.sourceKey.replace(/^poker-tracker:v\d+:/, "").replace(/[^a-z0-9-]+/gi, "-");
  const filename = `poker-tracker-unreadable-${name}-${record.detectedAt.slice(0, 10)}.json`;
  downloadText(filename, asBackup(record) ?? record.raw);
}

export function StorageRecoveryNotice() {
  const [records, setRecords] = useState(listQuarantined);

  useEffect(() => {
    // Other components may keep copies while rendering (e.g. when loading Player History).
    const refresh = () => setRecords(listQuarantined());
    refresh();
    window.addEventListener(QUARANTINE_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(QUARANTINE_CHANGED_EVENT, refresh);
  }, []);

  if (records.length === 0) return null;

  return (
    <>
      {records.map((record) => {
        const { title, body } = describe(record);
        return (
          <section className="backup-reminder storage-recovery" aria-label="Unreadable saved data" key={record.id}>
            <FileWarning size={20} aria-hidden="true" />
            <div className="backup-reminder-copy">
              <strong>{title}</strong>
              <p>{body}</p>
            </div>
            <div className="backup-reminder-actions">
              <button className="primary-button" type="button" onClick={() => downloadRecord(record)}>
                Download copy
              </button>
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  if (window.confirm("Delete the kept copy of this data? This can't be undone.")) {
                    deleteQuarantined(record.id);
                  }
                }}
              >
                Delete copy
              </button>
            </div>
          </section>
        );
      })}
    </>
  );
}
