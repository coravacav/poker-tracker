import { DatabaseBackup, Download, RotateCcw, Upload } from "lucide-react";
import { useRef, useState } from "react";
import type { Dispatch } from "react";
import type { GameAction } from "../state/gameReducer";
import type { GameState } from "../domain/pokerTypes";
import { validatePersistedState } from "../domain/validation";
import { downloadJson, exportFullBackup, parseBackup } from "../state/backup";
import { archiveGame, mergeArchivedGames } from "../state/gameArchive";
import { mergeStoredPeople } from "../state/peopleStore";

type ExportImportControlsProps = {
  dispatch: Dispatch<GameAction>;
  readOnly?: boolean;
  state: GameState;
};

export function ExportImportControls({ dispatch, readOnly = false, state }: ExportImportControlsProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function exportGame() {
    downloadJson(`${state.settings.gameName || "poker-tracker"}.json`, state);
  }

  async function importGame(file: File | undefined) {
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const backup = parseBackup(parsed);

      if (backup) {
        setBusy(true);
        if (!(await mergeArchivedGames(backup.archivedGames))) {
          setError("Could not restore Player History on this device.");
          return;
        }
        const peopleRestored = mergeStoredPeople(backup.people);
        if (backup.currentGame) {
          // Keep an in-progress game that the backup would otherwise replace.
          if (
            backup.currentGame.localGameId !== state.localGameId &&
            state.transactions.length > 0 &&
            !(await archiveGame(state))
          ) {
            setError("Player History was restored, but the current game could not be saved to it, so it was kept.");
            return;
          }
          dispatch({ type: "replace_state_from_import", state: backup.currentGame });
        }
        setError(
          peopleRestored
            ? null
            : "Player History was restored, but its people list could not be saved on this device."
        );
        return;
      }

      if (!validatePersistedState(parsed)) {
        setError("Import did not match the saved game schema.");
        return;
      }

      dispatch({ type: "replace_state_from_import", state: parsed });
      setError(null);
    } catch {
      setError("Could not read that JSON file.");
    } finally {
      setBusy(false);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  }

  async function resetGame() {
    if (!window.confirm("Archive this poker session and start a new game?")) return;
    setBusy(true);
    try {
      if (state.transactions.length > 0 && !(await archiveGame(state))) {
        setError("Could not save this game to Player History. Your game is still intact.");
        return;
      }
      dispatch({ type: "reset_game" });
      setError(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="export-row setup-field-wide">
      {/* File actions share a row; the red reset sits apart on its own line, away from them. */}
      <div className="export-row-files" role="group" aria-label="Game files">
        <button className="text-button" type="button" onClick={exportGame} title="Export JSON" aria-label="Export JSON">
          <Download size={16} aria-hidden="true" />Export
        </button>
        <button
          className="text-button"
          type="button"
          onClick={() => void exportFullBackup(state)}
          title="Back up all games"
          aria-label="Back up all games"
        >
          <DatabaseBackup size={16} aria-hidden="true" />Back up
        </button>
        <button
          className="text-button"
          type="button"
          disabled={readOnly || busy}
          onClick={() => inputRef.current?.click()}
          title="Import JSON or backup"
          aria-label="Import JSON or backup"
        >
          <Upload size={16} aria-hidden="true" />Import
        </button>
      </div>
      <button className="text-button export-row-reset" type="button" disabled={readOnly || busy} onClick={() => void resetGame()}>
        <RotateCcw size={16} aria-hidden="true" />Archive and start new game
      </button>
      <input
        ref={inputRef}
        hidden
        type="file"
        accept="application/json"
        onChange={(event) => void importGame(event.currentTarget.files?.[0])}
      />
      {error ? <span className="inline-error">{error}</span> : null}
    </div>
  );
}
