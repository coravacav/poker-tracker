import { Archive, AtSign, ListPlus, MapPin, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Dispatch } from "react";
import { hasPlayerTransactions } from "../domain/ledger";
import { indexPeople, personVenmoHandle, resolvePersonForName, venmoHandleForLink } from "../domain/people";
import type { Player, Transaction } from "../domain/pokerTypes";
import type { PersonSuggestion } from "../domain/sessionHistory";
import { normalizeVenmoHandle, venmoHandleError } from "../domain/venmo";
import type { GameAction } from "../state/gameReducer";
import { savePersonVenmoHandle } from "../state/peopleStore";
import { usePersonSuggestions } from "../state/usePeople";
import { PersonNameAssist } from "./PersonNameAssist";
import { VenmoHandleInput } from "./VenmoHandleInput";

type PlayerDrawerProps = {
  dispatch: Dispatch<GameAction>;
  fastEntryDisabled: boolean;
  players: Player[];
  readOnly: boolean;
  transactions: Transaction[];
};

export function PlayerDrawer({
  dispatch,
  fastEntryDisabled,
  players,
  readOnly,
  transactions
}: PlayerDrawerProps) {
  const [draftNames, setDraftNames] = useState<Record<string, string>>({});
  const [fastEntryOpen, setFastEntryOpen] = useState(false);
  const [fastEntryDraft, setFastEntryDraft] = useState("");
  const [fastEntryError, setFastEntryError] = useState<string | null>(null);
  const [editingPlayerId, setEditingPlayerId] = useState<string | null>(null);
  const [venmoEditor, setVenmoEditor] = useState<{ playerId: string; input: string; error: string | null } | null>(
    null
  );
  const { directory, suggestions } = usePersonSuggestions();
  // A person picked from suggestions, kept until the name is typed over (a shared room may not have echoed it yet).
  const pickedPeople = useRef(new Map<string, { name: string; personId: string | null }>());
  const nameInputRefs = useRef(new Map<string, HTMLInputElement>());
  const focusAddedPlayerRef = useRef(false);

  useEffect(() => {
    for (const player of players) {
      const picked = pickedPeople.current.get(player.id);
      if (picked && picked.name === player.name && picked.personId === (player.personId ?? null)) {
        pickedPeople.current.delete(player.id);
      }
    }
    setDraftNames((current) => {
      const next: Record<string, string> = {};

      for (const player of players) {
        next[player.id] = current[player.id] ?? player.name;
      }

      return next;
    });
  }, [players]);

  useEffect(() => {
    if (!focusAddedPlayerRef.current) {
      return;
    }

    focusAddedPlayerRef.current = false;
    const newestPlayer = players[players.length - 1];
    const input = newestPlayer ? nameInputRefs.current.get(newestPlayer.id) : undefined;
    input?.focus();
    input?.select();
  }, [players]);

  useEffect(() => {
    if (readOnly || fastEntryDisabled) {
      setFastEntryOpen(false);
      setFastEntryError(null);
    }
  }, [fastEntryDisabled, readOnly]);

  const duplicateNames = new Set(
    players
      .map((player) => player.name.trim().toLowerCase())
      .filter((name, index, names) => name && names.indexOf(name) !== index)
  );

  function commitName(player: Player) {
    const draftName = draftNames[player.id] ?? player.name;

    if (!draftName.trim()) {
      setDraftNames((current) => ({
        ...current,
        [player.id]: player.name
      }));
      return;
    }

    // Exact name/alias matches link to a known person; other names are unlinked for now.
    const picked = pickedPeople.current.get(player.id);
    const current = picked ?? { name: player.name, personId: player.personId ?? null };
    const personId = resolvePersonForName(directory, draftName, current.personId ?? undefined);
    // A pick already sent its person's username (a shared room may not have echoed it yet).
    const venmoHandle = picked && personId === picked.personId
      ? undefined
      : venmoHandleForLink(directory, { personId: current.personId ?? undefined, venmoHandle: player.venmoHandle }, personId);
    const venmoChanged = venmoHandle !== undefined && venmoHandle !== (player.venmoHandle ?? null);
    if (draftName !== current.name || personId !== current.personId || venmoChanged) {
      dispatch({
        type: "rename_player",
        playerId: player.id,
        name: draftName,
        personId,
        ...(venmoChanged ? { venmoHandle } : {})
      });
    }
  }

  function openVenmoEditor(player: Player) {
    if (venmoEditor?.playerId === player.id) {
      setVenmoEditor(null);
      return;
    }
    const personId = resolvePersonForName(directory, player.name, player.personId);
    const remembered = personId ? personVenmoHandle(indexPeople(directory), personId) : undefined;
    setVenmoEditor({ playerId: player.id, input: player.venmoHandle ?? remembered ?? "", error: null });
  }

  function saveVenmoHandle(player: Player) {
    if (!venmoEditor || venmoEditor.playerId !== player.id) return;
    const error = venmoHandleError(venmoEditor.input);
    if (error) {
      setVenmoEditor({ ...venmoEditor, error });
      return;
    }
    const venmoHandle = normalizeVenmoHandle(venmoEditor.input);
    if (venmoHandle !== (player.venmoHandle ?? null)) {
      dispatch({ type: "set_player_venmo_handle", playerId: player.id, venmoHandle });
    }
    // Remember it for this person's later games.
    const personId = resolvePersonForName(directory, player.name, player.personId);
    if (personId) savePersonVenmoHandle(personId, venmoHandle);
    setVenmoEditor(null);
  }

  function pickPerson(player: Player, suggestion: PersonSuggestion) {
    setDraftNames((current) => ({ ...current, [player.id]: suggestion.name }));
    const current = pickedPeople.current.get(player.id) ?? { name: player.name, personId: player.personId ?? null };
    const personId = suggestion.personId ?? resolvePersonForName(directory, suggestion.name);
    pickedPeople.current.set(player.id, { name: suggestion.name, personId });
    const venmoHandle = venmoHandleForLink(
      directory,
      { personId: current.personId ?? undefined, venmoHandle: player.venmoHandle },
      personId
    );
    const venmoChanged = venmoHandle !== undefined && venmoHandle !== (player.venmoHandle ?? null);
    if (suggestion.name !== current.name || personId !== current.personId || venmoChanged) {
      dispatch({
        type: "rename_player",
        playerId: player.id,
        name: suggestion.name,
        personId,
        ...(venmoChanged ? { venmoHandle } : {})
      });
    }
  }

  function addPlayer() {
    focusAddedPlayerRef.current = true;
    dispatch({ type: "add_player" });
  }

  function advanceFrom(player: Player) {
    commitName(player);
    const playerIndex = players.findIndex((candidate) => candidate.id === player.id);
    const nextPlayer = players[playerIndex + 1];

    if (nextPlayer) {
      const input = nameInputRefs.current.get(nextPlayer.id);
      input?.focus();
      input?.select();
      return;
    }

    addPlayer();
  }

  function openFastEntry() {
    setFastEntryDraft(
      [...players]
        .sort((a, b) => a.seatIndex - b.seatIndex)
        .map((player) => player.name.trim())
        .filter((name) => !/^Player \d+$/.test(name))
        .join("\n")
    );
    setFastEntryError(null);
    setFastEntryOpen(true);
  }

  function cancelFastEntry() {
    setFastEntryOpen(false);
    setFastEntryDraft("");
    setFastEntryError(null);
  }

  function applyFastEntry() {
    const names = fastEntryDraft
      .split(/\r\n?|\n/)
      .map((name) => name.trim())
      .filter(Boolean);

    if (names.length === 0) {
      setFastEntryError("Enter at least one player name.");
      return;
    }

    const personIds = names.map((name, index) => resolvePersonForName(directory, name, players[index]?.personId));
    const venmoHandles = personIds.map((personId, index) => venmoHandleForLink(directory, players[index], personId));
    dispatch({
      type: "replace_active_players",
      names,
      personIds,
      ...(venmoHandles.some((handle) => handle !== undefined) ? { venmoHandles } : {})
    });
    setDraftNames({});
    setFastEntryOpen(false);
    setFastEntryDraft("");
    setFastEntryError(null);
  }

  const fastEntryTitle = readOnly
    ? "Turn off read-only mode to use fast entry"
    : fastEntryDisabled
      ? "Fast entry is unavailable after transactions or cash-out drafts exist"
      : "Enter player names in bulk";

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Seats</p>
          <h2>Players</h2>
        </div>
        <div className="player-heading-actions">
          <MapPin size={20} />
          <button
            className="text-button fast-entry-toggle"
            type="button"
            disabled={readOnly || fastEntryDisabled}
            onClick={openFastEntry}
            title={fastEntryTitle}
          >
            <ListPlus size={16} />
            Fast entry
          </button>
        </div>
      </div>

      {fastEntryOpen ? (
        <div className="fast-player-entry">
          <label>
            <span>Player names (one per line)</span>
            <textarea
              autoFocus
              rows={8}
              value={fastEntryDraft}
              onChange={(event) => {
                setFastEntryDraft(event.currentTarget.value);
                setFastEntryError(null);
              }}
            />
          </label>
          {fastEntryError ? (
            <span className="inline-error" role="alert">
              {fastEntryError}
            </span>
          ) : null}
          <div className="fast-player-entry-actions">
            <button className="text-button" type="button" onClick={cancelFastEntry}>
              Cancel
            </button>
            <button className="primary-button" type="button" onClick={applyFastEntry}>
              Apply players
            </button>
          </div>
        </div>
      ) : (
        <div className="player-list">
          {players.map((player) => {
            const hasTransactions = hasPlayerTransactions(player.id, transactions);
            const duplicate = duplicateNames.has(player.name.trim().toLowerCase());

            return (
              <div className="player-row" key={player.id}>
                <span className="seat-badge">Seat {player.seatIndex + 1}</span>
                <label>
                  <span className="sr-only">Player name</span>
                  <input
                    ref={(element) => {
                      if (element) {
                        nameInputRefs.current.set(player.id, element);
                      } else {
                        nameInputRefs.current.delete(player.id);
                      }
                    }}
                    type="text"
                    value={draftNames[player.id] ?? player.name}
                    disabled={readOnly}
                    onFocus={() => setEditingPlayerId(player.id)}
                    onBlur={() => {
                      setEditingPlayerId((current) => (current === player.id ? null : current));
                      commitName(player);
                    }}
                    onChange={(event) => {
                      const nextName = event.currentTarget.value;
                      pickedPeople.current.delete(player.id);

                      setDraftNames((current) => ({
                        ...current,
                        [player.id]: nextName
                      }));
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") {
                        return;
                      }

                      event.preventDefault();
                      advanceFrom(player);
                    }}
                  />
                </label>
                <button
                  className="icon-button"
                  type="button"
                  disabled={readOnly || players.length <= 1 || hasTransactions}
                  onClick={() => dispatch({ type: "archive_player", playerId: player.id })}
                  title={
                    hasTransactions
                      ? "Player has transactions and must stay visible"
                      : "Archive empty player"
                  }
                >
                  <Archive size={15} />
                </button>
                <button
                  className={`icon-button player-venmo-toggle ${player.venmoHandle ? "has-handle" : ""}`}
                  type="button"
                  disabled={readOnly}
                  aria-expanded={venmoEditor?.playerId === player.id}
                  aria-label={`Venmo username for ${player.name}`}
                  title={player.venmoHandle ? `Venmo @${player.venmoHandle}` : "Add a Venmo username"}
                  onClick={() => openVenmoEditor(player)}
                >
                  <AtSign size={15} />
                </button>
                {player.venmoHandle && venmoEditor?.playerId !== player.id ? (
                  <span className="player-venmo-handle">Venmo @{player.venmoHandle}</span>
                ) : null}
                {venmoEditor?.playerId === player.id && !readOnly ? (
                  <div className="player-venmo-editor">
                    <VenmoHandleInput
                      autoFocus
                      value={venmoEditor.input}
                      error={venmoEditor.error}
                      onChange={(input) => setVenmoEditor({ playerId: player.id, input, error: null })}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          saveVenmoHandle(player);
                        } else if (event.key === "Escape") {
                          setVenmoEditor(null);
                        }
                      }}
                    />
                    <div className="player-venmo-editor-row">
                      <button className="text-button" type="button" onClick={() => setVenmoEditor(null)}>
                        Cancel
                      </button>
                      <button className="primary-button" type="button" onClick={() => saveVenmoHandle(player)}>
                        Save
                      </button>
                    </div>
                  </div>
                ) : null}
                {duplicate ? <span className="inline-error">Duplicate</span> : null}
                {editingPlayerId === player.id && !readOnly ? (
                  <PersonNameAssist
                    name={draftNames[player.id] ?? player.name}
                    personId={player.personId}
                    directory={directory}
                    suggestions={suggestions}
                    otherPlayers={players.filter((candidate) => candidate.id !== player.id)}
                    showSuggestions
                    onPick={(suggestion) => pickPerson(player, suggestion)}
                  />
                ) : null}
              </div>
            );
          })}
          <button
            className="text-button add-player-button"
            type="button"
            disabled={readOnly}
            onClick={addPlayer}
          >
            <Plus size={16} />
            Add player
          </button>
        </div>
      )}
    </section>
  );
}
