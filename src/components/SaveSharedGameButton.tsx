import { History } from "lucide-react";
import { useState } from "react";
import type { GameState } from "../domain/pokerTypes";
import { hostCopyArchived, saveSharedGame, sharedGameArchiveId, type SaveSharedGameResult } from "../state/sharedGameArchive";
import { useArchivedGames } from "../state/useArchivedGames";

const MESSAGES: Record<Exclude<SaveSharedGameResult, "saved">, string> = {
  stale: "Player History already has this game from a room that closed later.",
  hosted: "You hosted this game, so it is already in Player History.",
  empty: "This game has no transactions to save.",
  failed: "Could not save to Player History on this device."
};

/**
 * Lets a guest keep a finished shared room's game in this device's Player
 * History (see state/sharedGameArchive.ts). Hidden when Player History holds
 * the host's own copy. In `compact` form (the guest bar) the result is
 * announced but not shown, so the bar keeps its size.
 */
export function SaveSharedGameButton({
  state,
  closedAt,
  compact = false
}: {
  state: GameState;
  /** When the room closed (roomClosedAt), kept with the copy to order rooms of one game. */
  closedAt: number;
  compact?: boolean;
}) {
  const games = useArchivedGames();
  const [result, setResult] = useState<SaveSharedGameResult | "saving" | null>(null);
  const ids = (games ?? []).map((game) => game.state.localGameId);
  if (hostCopyArchived(state.localGameId, ids)) return null;
  const saved = ids.includes(sharedGameArchiveId(state.localGameId));

  async function save() {
    setResult("saving");
    setResult(await saveSharedGame(state, closedAt));
  }

  const message = result === "saved" ? "Saved to Player History." : result && result !== "saving" ? MESSAGES[result] : "";
  return (
    <>
      <button
        className="text-button"
        type="button"
        disabled={state.transactions.length === 0 || result === "saving"}
        onClick={() => void save()}
      >
        <History size={15} aria-hidden="true" />
        {result === "saving" ? "Saving…" : saved ? "Update in Player History" : "Save to Player History"}
      </button>
      <span className={compact ? "sr-only" : "save-shared-game-status"} role="status">
        {message}
      </span>
    </>
  );
}
