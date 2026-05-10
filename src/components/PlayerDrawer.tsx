import { Archive, MapPin } from "lucide-react";
import { useEffect, useState } from "react";
import type { Dispatch } from "react";
import { hasPlayerTransactions } from "../domain/ledger";
import type { Player, Transaction } from "../domain/pokerTypes";
import type { GameAction } from "../state/gameReducer";

type PlayerDrawerProps = {
  dispatch: Dispatch<GameAction>;
  players: Player[];
  readOnly: boolean;
  transactions: Transaction[];
};

export function PlayerDrawer({
  dispatch,
  players,
  readOnly,
  transactions
}: PlayerDrawerProps) {
  const [draftNames, setDraftNames] = useState<Record<string, string>>({});

  useEffect(() => {
    setDraftNames((current) => {
      const next: Record<string, string> = {};

      for (const player of players) {
        next[player.id] = current[player.id] ?? player.name;
      }

      return next;
    });
  }, [players]);

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

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Seats</p>
          <h2>Players</h2>
        </div>
        <MapPin size={20} />
      </div>

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
      </div>
    </section>
  );
}
