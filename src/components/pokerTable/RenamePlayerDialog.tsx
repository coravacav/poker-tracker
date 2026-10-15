import { X } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { resolvePersonForName, venmoHandleForLink, type PeopleDirectory } from "../../domain/people";
import type { Player, PlayerId } from "../../domain/pokerTypes";
import type { PersonSuggestion } from "../../domain/sessionHistory";
import { normalizeVenmoHandle, venmoHandleError } from "../../domain/venmo";
import type { GameAction } from "../../state/gameReducer";
import { savePersonVenmoHandle } from "../../state/peopleStore";
import { PersonNameAssist } from "../PersonNameAssist";
import { VenmoHandleInput } from "../VenmoHandleInput";
import { useDialogFocus } from "../useDialogFocus";

export type RenameDraft = {
  playerId: PlayerId;
  nameInput: string;
  /** Person picked from suggestions (or the player's link when the dialog opened). */
  personId?: string;
  /** Typed Venmo username; until then the field follows the linked person's. */
  venmoInput?: string;
};

type RenamePlayerDialogProps = {
  renameDraft: RenameDraft;
  setRenameDraft: Dispatch<SetStateAction<RenameDraft | null>>;
  renameError: string | null;
  setRenameError: Dispatch<SetStateAction<string | null>>;
  activePlayers: Player[];
  peopleDirectory: PeopleDirectory;
  personSuggestions: PersonSuggestion[];
  dispatch: Dispatch<GameAction>;
  playerName: (playerId: PlayerId) => string;
};

/** Rename a seated player, link them to a known person, and set their Venmo username. */
export function RenamePlayerDialog({
  renameDraft,
  setRenameDraft,
  renameError,
  setRenameError,
  activePlayers,
  peopleDirectory,
  personSuggestions,
  dispatch,
  playerName
}: RenamePlayerDialogProps) {
  const dialogRef = useDialogFocus<HTMLElement>(true, () => setRenameDraft(null));
  /** The Venmo username the rename dialog shows: typed, or else the one the new link implies. */
  function renameVenmoHandle(draft: RenameDraft): string {
    if (draft.venmoInput !== undefined) return draft.venmoInput;
    const player = activePlayers.find((candidate) => candidate.id === draft.playerId);
    const personId = resolvePersonForName(peopleDirectory, draft.nameInput, draft.personId);
    const linked = venmoHandleForLink(peopleDirectory, player, personId);
    return linked === undefined ? player?.venmoHandle ?? "" : linked ?? "";
  }

  function confirmRename() {
    if (!renameDraft) {
      return;
    }

    const name = renameDraft.nameInput.trim();
    if (!name) {
      setRenameError("Enter a player name.");
      return;
    }
    const venmoError = venmoHandleError(renameVenmoHandle(renameDraft));
    if (venmoError) {
      setRenameError(venmoError);
      return;
    }

    const player = activePlayers.find((candidate) => candidate.id === renameDraft.playerId);
    const personId = resolvePersonForName(peopleDirectory, name, renameDraft.personId);
    const venmoHandle = normalizeVenmoHandle(renameVenmoHandle(renameDraft));
    const venmoChanged = venmoHandle !== (player?.venmoHandle ?? null);
    if (name !== player?.name || personId !== (player?.personId ?? null) || venmoChanged) {
      dispatch({
        type: "rename_player",
        playerId: renameDraft.playerId,
        name,
        personId,
        ...(venmoChanged ? { venmoHandle } : {})
      });
    }
    // A username typed here is remembered for this person's later games.
    if (renameDraft.venmoInput !== undefined && personId) savePersonVenmoHandle(personId, venmoHandle);
    setRenameDraft(null);
    setRenameError(null);
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        ref={dialogRef}
        tabIndex={-1}
        className="modal table-action-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Rename player"
      >
        <div className="modal-heading">
          <div>
            <p className="eyebrow">Seat action</p>
            <h2>Rename {playerName(renameDraft.playerId)}</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={() => setRenameDraft(null)}
            title="Close"
          >
            <X size={17} />
          </button>
        </div>
        <label>
          <span>Player name</span>
          <input
            value={renameDraft.nameInput}
            onChange={(event) =>
              // Typing keeps the link only while the name still belongs to that person.
              setRenameDraft({ ...renameDraft, nameInput: event.currentTarget.value })
            }
          />
        </label>
        <PersonNameAssist
          name={renameDraft.nameInput}
          personId={renameDraft.personId}
          directory={peopleDirectory}
          suggestions={personSuggestions}
          otherPlayers={activePlayers.filter((player) => player.id !== renameDraft.playerId)}
          showSuggestions
          onPick={(suggestion) =>
            setRenameDraft({
              playerId: renameDraft.playerId,
              nameInput: suggestion.name,
              ...(suggestion.personId ? { personId: suggestion.personId } : {}),
              ...(renameDraft.venmoInput !== undefined ? { venmoInput: renameDraft.venmoInput } : {})
            })
          }
        />
        <VenmoHandleInput
          value={renameVenmoHandle(renameDraft)}
          onChange={(venmoInput) => {
            setRenameDraft({ ...renameDraft, venmoInput });
            setRenameError(null);
          }}
        />
        {renameError ? <div className="notice notice-warning">{renameError}</div> : null}
        <div className="modal-actions">
          <button type="button" onClick={() => setRenameDraft(null)}>
            Cancel
          </button>
          <button className="primary-button" type="button" onClick={confirmRename}>
            Save name
          </button>
        </div>
      </section>
    </div>
  );
}
