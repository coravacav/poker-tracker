import { BarChart3, Pencil, X } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { formatCurrency } from "../domain/money";
import {
  indexPeople,
  mergeIntoPerson,
  nameKey,
  renamePerson,
  separateAlias,
  separatePerson,
  type MergeSource,
  type PeopleDirectory,
  type PeopleResult
} from "../domain/people";
import { buildPlayerHistoryStats, type PlayerHistoryStat } from "../domain/sessionHistory";
import { useArchivedGames } from "../state/useArchivedGames";
import { canSavePeopleDirectory, updatePeopleDirectory } from "../state/peopleStore";
import { createId } from "../state/seedGame";
import { usePeopleDirectory } from "../state/usePeople";
import type { RoomHistoryProjection } from "../session/types";
import { buildPlayerSummaries } from "../domain/ledger";

type MergedPart = { kind: "alias"; personId: string; label: string } | { kind: "person"; personId: string; label: string };

function mergedParts(directory: PeopleDirectory, personId: string): MergedPart[] {
  const index = indexPeople(directory);
  const person = index.byId.get(personId);
  if (!person) return [];
  return [
    // An alias repeating the display name only settles a shared name; there is nothing to separate.
    ...person.aliases
      .filter((alias) => nameKey(alias) !== nameKey(person.name))
      .map((alias): MergedPart => ({ kind: "alias", personId, label: alias })),
    ...index.mergedInto(personId).map((merged): MergedPart => ({ kind: "person", personId: merged.id, label: merged.name }))
  ];
}

function mergeSource(stat: PlayerHistoryStat): MergeSource {
  return stat.personId ? { personId: stat.personId } : { name: stat.name };
}

const SAVE_FAILED = "Could not save the change on this device.";

export function SessionHistoryPanel({ sharedRooms = [] }: { sharedRooms?: RoomHistoryProjection[] }) {
  const games = useArchivedGames();
  const directory = usePeopleDirectory();
  const stats = useMemo(() => buildPlayerHistoryStats(games ?? [], directory), [directory, games]);
  const [managing, setManaging] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [mergeName, setMergeName] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ key: string; value: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const statByKey = new Map(stats.map((stat) => [stat.key, stat]));
  const selectedStats = selected.flatMap((key) => statByKey.get(key) ?? []);
  // Keep the person with the most games (their id stays); default to the most-played name.
  const mergeOrder = [...selectedStats].sort(
    (left, right) => Number(Boolean(right.personId)) - Number(Boolean(left.personId)) || right.games - left.games
  );
  const suggestedMergeName = [...selectedStats].sort((left, right) => right.games - left.games)[0]?.name ?? "";

  function apply(change: (directory: PeopleDirectory, now: string) => PeopleResult | PeopleDirectory): boolean {
    let failure: string | null = null;
    const saved = updatePeopleDirectory((current) => {
      const result = change(current, new Date().toISOString());
      if ("error" in result) {
        failure = result.error;
        return null;
      }
      return "directory" in result ? result.directory : result;
    });
    setError(saved ? null : failure ?? SAVE_FAILED);
    return saved !== null;
  }

  function toggle(key: string) {
    setSelected((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]));
    setMergeName(null);
  }

  function merge() {
    const name = (mergeName ?? suggestedMergeName).trim();
    if (apply((current, now) => mergeIntoPerson(current, mergeOrder.map(mergeSource), name, now, createId("person")))) {
      setSelected([]);
      setMergeName(null);
    }
  }

  function saveRename(stat: PlayerHistoryStat, value: string) {
    const namesake = stats.find((other) => other.key !== stat.key && nameKey(other.name) === nameKey(value));
    if (namesake) {
      // Renaming onto another row's name would quietly combine them; make that an explicit merge.
      setError(`${namesake.name} is already in Player History. If they are the same person, select both and merge them instead.`);
      return;
    }
    const ok = apply((current, now) =>
      stat.personId
        ? renamePerson(current, stat.personId, value, now)
        : mergeIntoPerson(current, [{ name: stat.name }], value, now, createId("person"))
    );
    if (ok) setRenaming(null);
  }

  function stopManaging() {
    setManaging(false);
    setSelected([]);
    setMergeName(null);
    setRenaming(null);
    setError(null);
  }

  return (
    <section className="panel session-history-panel" aria-label="Session history">
      <div className="panel-heading">
        <div><p className="eyebrow">Across poker nights</p><h2>Player History</h2></div>
        <div className="history-heading-actions">
          {games && stats.length > 0 ? (
            <button
              className="text-button"
              type="button"
              aria-pressed={managing}
              disabled={!managing && !canSavePeopleDirectory()}
              onClick={() => (managing ? stopManaging() : setManaging(true))}
            >
              {managing ? "Done" : "Merge or rename"}
            </button>
          ) : null}
          <BarChart3 size={20} />
        </div>
      </div>
      {games === null ? (
        <p className="muted" role="status">Loading Player History…</p>
      ) : games.length === 0 ? (
        <p className="muted">Completed games appear here after you archive and start a new game.</p>
      ) : (
        <>
          <p className="muted">
            {games.length} archived {games.length === 1 ? "game" : "games"}
            {managing ? " · Select players who are the same person to merge them, or rename one." : ""}
          </p>
          {error ? <div className="notice notice-warning" role="alert">{error}</div> : null}
          <div className="history-stat-list">
            {stats.map((stat) => {
              const parts = managing && stat.personId ? mergedParts(directory, stat.personId) : [];
              const isRenaming = renaming?.key === stat.key;
              return (
                <div className={`history-stat-row ${managing ? "is-managing" : ""}`} key={stat.key}>
                  {managing ? (
                    <label className="history-stat-select">
                      <input
                        type="checkbox"
                        checked={selected.includes(stat.key)}
                        onChange={() => toggle(stat.key)}
                        aria-label={`Select ${stat.name}`}
                      />
                      <strong>{stat.name}</strong>
                    </label>
                  ) : (
                    <strong>{stat.name}</strong>
                  )}
                  {stat.results.map((result, index) => (
                    // One line per currency; amounts in different currencies are never added up.
                    <Fragment key={result.currencyCode}>
                      {index > 0 ? <span className="history-stat-spacer" aria-hidden="true" /> : null}
                      <span>{result.games} {result.games === 1 ? "game" : "games"}</span>
                      <span>Avg {formatCurrency(result.averageNetCents, result.currencyCode)}</span>
                      <strong className={result.totalNetCents >= 0 ? "positive" : "negative"}>
                        {formatCurrency(result.totalNetCents, result.currencyCode)}
                      </strong>
                    </Fragment>
                  ))}
                  {managing ? (
                    <div className="history-stat-manage">
                      {isRenaming ? (
                        <form
                          className="history-rename-form"
                          onSubmit={(event) => {
                            event.preventDefault();
                            saveRename(stat, renaming.value);
                          }}
                        >
                          <input
                            aria-label={`New name for ${stat.name}`}
                            autoFocus
                            maxLength={80}
                            value={renaming.value}
                            onChange={(event) => setRenaming({ key: stat.key, value: event.currentTarget.value })}
                          />
                          <button className="primary-button" type="submit" disabled={!renaming.value.trim()}>
                            Save
                          </button>
                          <button className="text-button" type="button" onClick={() => setRenaming(null)}>
                            Cancel
                          </button>
                        </form>
                      ) : (
                        <>
                          {parts.length > 0 ? <span className="muted">Includes</span> : null}
                          {parts.map((part) => (
                            <span className="history-alias-chip" key={`${part.kind}:${part.personId}:${part.label}`}>
                              {part.label}
                              <button
                                type="button"
                                aria-label={`Separate ${part.label} from ${stat.name}`}
                                title="Separate"
                                onClick={() =>
                                  apply((current, now) =>
                                    part.kind === "alias"
                                      ? separateAlias(current, part.personId, part.label, now)
                                      : separatePerson(current, part.personId, now)
                                  )
                                }
                              >
                                <X size={13} aria-hidden="true" />
                              </button>
                            </span>
                          ))}
                          <button
                            className="text-button history-rename-button"
                            type="button"
                            aria-label={`Rename ${stat.name}`}
                            onClick={() => setRenaming({ key: stat.key, value: stat.name })}
                          >
                            <Pencil size={14} aria-hidden="true" />
                            Rename
                          </button>
                        </>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          {managing ? (
            <div className="history-merge-bar">
              {selectedStats.length < 2 ? (
                <p className="muted">
                  {selectedStats.length === 0 ? "Select two or more players to merge." : "Select another player to merge with."}
                </p>
              ) : (
                <form
                  className="history-merge-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    merge();
                  }}
                >
                  <label>
                    <span>Merged name</span>
                    <input
                      maxLength={80}
                      value={mergeName ?? suggestedMergeName}
                      onChange={(event) => setMergeName(event.currentTarget.value)}
                    />
                  </label>
                  <button
                    className="primary-button"
                    type="submit"
                    disabled={!(mergeName ?? suggestedMergeName).trim()}
                  >
                    Merge {selectedStats.length} players
                  </button>
                </form>
              )}
            </div>
          ) : null}
        </>
      )}
      <div className="shared-room-history">
        <h3>Shared rooms</h3>
        {sharedRooms.length === 0 ? (
          <p className="muted">Rooms you host or join on this device will remain available here.</p>
        ) : sharedRooms.map((room) => {
          const summaries = buildPlayerSummaries(room.state.players, room.state.transactions);
          return (
            <details key={`${room.role}:${room.publicId}`}>
              <summary>
                <strong>{room.name}</strong>
                <span>{room.role === "host" ? "Hosted" : `Joined as ${room.displayName ?? "guest"}`}</span>
                <span>{room.status}</span>
                <time dateTime={new Date(room.createdAt).toISOString()}>{new Date(room.createdAt).toLocaleDateString()}</time>
              </summary>
              <div className="shared-room-results">
                {summaries.map((summary) => (
                  <span key={summary.playerId}>
                    {room.state.players.find((player) => player.id === summary.playerId)?.name ?? "Player"}
                    <strong className={summary.netCents >= 0 ? "positive" : "negative"}>{formatCurrency(summary.netCents, room.state.settings.currencyCode)}</strong>
                  </span>
                ))}
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}
