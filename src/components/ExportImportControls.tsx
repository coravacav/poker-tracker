import { Download, RotateCcw, Upload } from "lucide-react";
import { useRef, useState } from "react";
import type { Dispatch } from "react";
import type { GameAction } from "../state/gameReducer";
import type { GameState } from "../domain/pokerTypes";
import { validatePersistedState } from "../domain/validation";

type ExportImportControlsProps = {
  dispatch: Dispatch<GameAction>;
  state: GameState;
};

export function ExportImportControls({ dispatch, state }: ExportImportControlsProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  function exportGame() {
    const blob = new Blob([JSON.stringify(state, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${state.settings.gameName || "poker-tracker"}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function importGame(file: File | undefined) {
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;

      if (!validatePersistedState(parsed)) {
        setError("Import did not match the saved game schema.");
        return;
      }

      dispatch({ type: "replace_state_from_import", state: parsed });
      setError(null);
    } catch {
      setError("Could not read that JSON file.");
    } finally {
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  }

  function resetGame() {
    if (window.confirm("Reset this poker session? The current local game will be replaced.")) {
      dispatch({ type: "reset_game" });
      setError(null);
    }
  }

  return (
    <div className="export-row">
      <button className="icon-button" type="button" onClick={exportGame} title="Export JSON">
        <Download size={17} />
      </button>
      <button
        className="icon-button"
        type="button"
        onClick={() => inputRef.current?.click()}
        title="Import JSON"
      >
        <Upload size={17} />
      </button>
      <button className="icon-button danger" type="button" onClick={resetGame} title="Reset game">
        <RotateCcw size={17} />
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
