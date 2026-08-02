import { Archive, ListPlus, MapPin, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Dispatch } from "react";
import { hasPlayerTransactions } from "../domain/ledger";
import type { Player, Transaction } from "../domain/pokerTypes";
import type { GameAction } from "../state/gameReducer";

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
  const nameInputRefs = useRef(new Map<string, HTMLInputElement>());
  const focusAddedPlayerRef = useRef(false);

  useEffect(() => {
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

    if (draftName !== player.name) {
      dispatch({
        type: "rename_player",
        playerId: player.id,
        name: draftName
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

    dispatch({ type: "replace_active_players", names });
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
                    onBlur={() => commitName(player)}
                    onChange={(event) => {
                      const nextName = event.currentTarget.value;

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
                {duplicate ? <span className="inline-error">Duplicate</span> : null}
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
