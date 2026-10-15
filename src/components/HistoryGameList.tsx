/**
 * The archived games behind one Player History row, newest first, each with a
 * way to correct who that game's player was: not this person, another person,
 * or a new person. Changes are written to that game only.
 */
import { useState } from "react";
import { gamePlayedAtMs } from "../domain/historyTrends";
import { formatCurrency } from "../domain/money";
import { indexPeople, isPlaceholderName, MAX_PERSON_NAME_LENGTH, nameKey, type PeopleDirectory } from "../domain/people";
import { historyRowLabel, type PlayerGameEntry, type PlayerHistoryStat } from "../domain/sessionHistory";
import { relinkArchivedPlayers, type RelinkTarget } from "../state/archivedPlayerLinks";

const fullDate = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" });

function signed(cents: number, entry: PlayerGameEntry): string {
  return `${cents > 0 ? "+" : ""}${formatCurrency(cents, entry.currencyCode)}`;
}

function tone(cents: number): string {
  return cents > 0 ? "positive" : cents < 0 ? "negative" : "neutral";
}

export function gameTitle(entry: PlayerGameEntry): string {
  return entry.game.state.settings.gameName.trim() || "Untitled game";
}

const entryKey = (entry: PlayerGameEntry) => `${entry.game.state.localGameId}:${entry.playerId}`;

type Editing = { key: string; choice: string; name: string };

export function HistoryGameList({
  id,
  row,
  entries,
  directory,
  onSaved,
  onError
}: {
  id: string;
  row: Pick<PlayerHistoryStat, "key" | "personId" | "name" | "keptApart">;
  /** The row's games in the shown date range. */
  entries: PlayerGameEntry[];
  directory: PeopleDirectory;
  onSaved: (message: string) => void;
  onError: (message: string | null) => void;
}) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const [busy, setBusy] = useState(false);
  const index = indexPeople(directory);
  const label = historyRowLabel(row);
  const people = directory.people
    .filter((person) => !person.mergedIntoId && person.id !== row.personId)
    .sort((left, right) => left.name.localeCompare(right.name));
  const sorted = [...entries].sort(
    (left, right) => gamePlayedAtMs(right.game) - gamePlayedAtMs(left.game) || entryKey(left).localeCompare(entryKey(right))
  );

  function startEditing(entry: PlayerGameEntry) {
    // A free recorded name (say "Al" picked as Alexander) is the likely name for a new person. The
    // row's own name is not offered: on a name row it would also claim that row's other games.
    const free =
      !isPlaceholderName(entry.playerName) &&
      nameKey(entry.playerName) !== nameKey(row.name) &&
      index.lookupName(entry.playerName).kind === "none";
    setEditing({ key: entryKey(entry), choice: row.personId ? "unlink" : "", name: free ? entry.playerName : "" });
    onError(null);
  }

  async function save(entry: PlayerGameEntry, current: Editing) {
    const from = row.personId ? { fromPersonId: row.personId } : {};
    let target: RelinkTarget;
    let destination: string;
    if (current.choice === "unlink" && row.personId) {
      target = { kind: "unlink", personId: row.personId };
      destination = "";
    } else if (current.choice === "new") {
      target = { kind: "new", name: current.name, ...from };
      destination = current.name.trim().replace(/\s+/g, " ");
    } else if (current.choice.startsWith("person:")) {
      const personId = current.choice.slice("person:".length);
      target = { kind: "person", personId, ...from };
      destination = index.root(personId)?.name ?? "";
    } else {
      return;
    }
    setBusy(true);
    try {
      const result = await relinkArchivedPlayers([{ gameId: entry.game.state.localGameId, playerId: entry.playerId }], target);
      if ("error" in result) {
        onError(result.error);
        return;
      }
      setEditing(null);
      onError(null);
      onSaved(
        destination
          ? `${entry.playerName || "The player"} in ${gameTitle(entry)} now counts for ${destination}.`
          : `${entry.playerName || "The player"} in ${gameTitle(entry)} no longer counts for ${row.name}.`
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="history-games" id={id}>
      {sorted.length === 0 ? <p className="muted">No games in this range.</p> : null}
      <ul className="history-game-list" aria-label={`Games for ${label}`}>
        {sorted.map((entry) => {
          const key = entryKey(entry);
          const current = editing?.key === key ? editing : null;
          const date = fullDate.format(gamePlayedAtMs(entry.game));
          const title = gameTitle(entry);
          const recordedAs = entry.playerName && entry.playerName !== row.name ? entry.playerName : null;
          return (
            <li className="history-game" key={key}>
              <div className="history-game-summary">
                <span className="history-game-name">{title}</span>
                <span className="muted">
                  <time dateTime={new Date(gamePlayedAtMs(entry.game)).toISOString()}>{date}</time>
                  {recordedAs ? ` · as ${recordedAs}` : ""}
                </span>
              </div>
              <strong className={tone(entry.netCents)}>{signed(entry.netCents, entry)}</strong>
              {current ? null : (
                <button
                  className="text-button history-game-change"
                  type="button"
                  aria-label={`Change who ${entry.playerName || "this player"} was in ${title} on ${date}`}
                  disabled={busy}
                  onClick={() => startEditing(entry)}
                >
                  Change
                </button>
              )}
              {current ? (
                <form
                  className="history-relink-form"
                  aria-label={`Who ${entry.playerName || "this player"} was in ${title}`}
                  onSubmit={(event) => {
                    event.preventDefault();
                    void save(entry, current);
                  }}
                >
                  <label>
                    <span>Counts for</span>
                    <select
                      value={current.choice}
                      onChange={(event) => setEditing({ ...current, choice: event.currentTarget.value })}
                    >
                      {row.personId ? (
                        <option value="unlink">Not {row.name} (keep the name only)</option>
                      ) : (
                        <option value="" disabled>Choose a person</option>
                      )}
                      {people.length > 0 ? (
                        <optgroup label="People">
                          {people.map((person) => (
                            <option key={person.id} value={`person:${person.id}`}>{person.name}</option>
                          ))}
                        </optgroup>
                      ) : null}
                      <option value="new">New person…</option>
                    </select>
                  </label>
                  {current.choice === "new" ? (
                    <label>
                      <span>New person's name</span>
                      <input
                        autoFocus
                        maxLength={MAX_PERSON_NAME_LENGTH}
                        value={current.name}
                        onChange={(event) => setEditing({ ...current, name: event.currentTarget.value })}
                      />
                    </label>
                  ) : null}
                  <div className="history-relink-actions">
                    <button
                      className="primary-button"
                      type="submit"
                      disabled={busy || !current.choice || (current.choice === "new" && !current.name.trim())}
                    >
                      Save
                    </button>
                    <button className="text-button" type="button" disabled={busy} onClick={() => setEditing(null)}>
                      Cancel
                    </button>
                  </div>
                  {current.choice === "unlink" ? (
                    <p className="muted history-relink-note">
                      Only this game changes. The name {entry.playerName || row.name} will not link it back to {row.name}.
                    </p>
                  ) : null}
                </form>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
