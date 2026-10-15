import { BarChart3, ChevronDown, ListTree, Pencil, X } from "lucide-react";
import { Component, Fragment, lazy, Suspense, useMemo, useState, type ReactNode } from "react";
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
import {
  buildPlayerHistoryStats,
  groupPlayerHistory,
  historyRowLabel,
  type PlayerHistoryStat
} from "../domain/sessionHistory";
import { filterGamesByRange, HISTORY_RANGES, historyCurrencies, type HistoryRange } from "../domain/historyTrends";

import { relinkArchivedPlayers } from "../state/archivedPlayerLinks";
import { useArchivedGames } from "../state/useArchivedGames";
import { canSavePeopleDirectory, updatePeopleDirectory } from "../state/peopleStore";
import { createId } from "../state/seedGame";
import { usePeopleDirectory } from "../state/usePeople";
import type { RoomHistoryProjection } from "../session/types";
import { buildPlayerSummaries } from "../domain/ledger";
import { HistoryGameList } from "./HistoryGameList";

// Charts (and the charting library) load on demand so they stay out of the main bundle.
const HistoryTrends = lazy(() => import("./HistoryTrends"));

/** Keeps Player History usable when the chart code cannot load (for example offline before it was cached). */
class TrendsBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? (
      <p className="history-chart-message muted" role="status">
        Charts could not be loaded. The totals above are unaffected; try again when you are online.
      </p>
    ) : this.props.children;
  }
}

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
  const [range, setRange] = useState<HistoryRange>("all");
  const [managing, setManaging] = useState(false);
  // Merging and renaming always work on every game, so no row is hidden from them.
  const effectiveRange: HistoryRange = managing ? "all" : range;
  const rangeGames = useMemo(
    () => filterGamesByRange(games ?? [], effectiveRange, Date.now()),
    [effectiveRange, games]
  );
  const allStats = useMemo(() => buildPlayerHistoryStats(games ?? [], directory), [directory, games]);
  const stats = useMemo(
    () => (effectiveRange === "all" ? allStats : buildPlayerHistoryStats(rangeGames, directory)),
    [allStats, directory, effectiveRange, rangeGames]
  );
  // The games behind each row, for its game list.
  const groupByKey = useMemo(
    () => new Map(groupPlayerHistory(rangeGames, directory).map((group) => [group.key, group])),
    [directory, rangeGames]
  );
  const rangeCurrencies = useMemo(() => historyCurrencies(rangeGames), [rangeGames]);
  const rangeLabel = effectiveRange === "all" ? "" : `in the last ${HISTORY_RANGES.find((option) => option.value === effectiveRange)!.label.toLowerCase()}`;
  const [selected, setSelected] = useState<string[]>([]);
  const [mergeName, setMergeName] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ key: string; value: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

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

  function toggleGames(key: string) {
    setExpanded((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]));
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

  async function saveRename(stat: PlayerHistoryStat, value: string) {
    const namesake = allStats.find((other) => other.key !== stat.key && nameKey(other.name) === nameKey(value));
    if (namesake) {
      // Renaming onto another row's name would quietly combine them; make that an explicit merge.
      setError(`${namesake.name} is already in Player History. If they are the same person, select both and merge them instead.`);
      return;
    }
    if (stat.keptApart) {
      // Its name belongs to someone else, so naming it links its games to a new person instead of claiming the name.
      const entries = groupByKey.get(stat.key)?.entries ?? [];
      setBusy(true);
      try {
        const result = await relinkArchivedPlayers(
          entries.map((entry) => ({ gameId: entry.game.state.localGameId, playerId: entry.playerId })),
          { kind: "new", name: value }
        );
        if ("error" in result) {
          setError(result.error);
          return;
        }
        setError(null);
        setRenaming(null);
        setStatus(`${historyRowLabel(stat)} is now ${value.trim()}.`);
      } finally {
        setBusy(false);
      }
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
    setStatus(null);
  }

  return (
    <section className="panel session-history-panel" aria-label="Session history">
      <div className="panel-heading">
        <div><p className="eyebrow">Across poker nights</p><h2>Player History</h2></div>
        <div className="history-heading-actions">
          {games && allStats.length > 0 ? (
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
          <div className="history-filters">
            <div className="history-range" role="group" aria-label="Date range">
              {HISTORY_RANGES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={effectiveRange === option.value}
                  disabled={managing}
                  onClick={() => setRange(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <p className="muted">
            {effectiveRange === "all"
              ? `${games.length} archived ${games.length === 1 ? "game" : "games"}`
              : `${rangeGames.length} of ${games.length} archived ${games.length === 1 ? "game" : "games"} ${rangeLabel}`}
            {managing ? " · Select players who are the same person to merge them, or rename one." : ""}
          </p>
          {!managing && rangeGames.length === 0 ? <p className="muted">No games {rangeLabel}.</p> : null}
          {error ? <div className="notice notice-warning" role="alert">{error}</div> : null}
          <p className="history-status" role="status">{status}</p>
          <div className="history-stat-list">
            {stats.map((stat, rowIndex) => {
              const parts = managing && stat.personId ? mergedParts(directory, stat.personId) : [];
              const isRenaming = renaming?.key === stat.key;
              const label = historyRowLabel(stat);
              const isOpen = expanded.includes(stat.key);
              const gamesId = `history-games-${rowIndex}`;
              return (
                <div className={`history-stat-row ${managing ? "is-managing" : ""}`} key={stat.key}>
                  {managing ? (
                    <label className="history-stat-select">
                      <input
                        type="checkbox"
                        checked={selected.includes(stat.key)}
                        // Merging by name would hand the name, and every game matched by it, to the merge.
                        disabled={stat.keptApart}
                        onChange={() => toggle(stat.key)}
                        aria-label={`Select ${label}`}
                      />
                      <strong>{label}</strong>
                    </label>
                  ) : (
                    <button
                      className="history-stat-name"
                      type="button"
                      aria-expanded={isOpen}
                      aria-controls={isOpen ? gamesId : undefined}
                      onClick={() => toggleGames(stat.key)}
                    >
                      <ChevronDown size={16} aria-hidden="true" />
                      <strong>{label}</strong>
                    </button>
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
                            void saveRename(stat, renaming.value);
                          }}
                        >
                          <input
                            aria-label={`New name for ${label}`}
                            autoFocus
                            maxLength={80}
                            value={renaming.value}
                            onChange={(event) => setRenaming({ key: stat.key, value: event.currentTarget.value })}
                          />
                          <button className="primary-button" type="submit" disabled={busy || !renaming.value.trim()}>
                            Save
                          </button>
                          <button className="text-button" type="button" onClick={() => setRenaming(null)}>
                            Cancel
                          </button>
                        </form>
                      ) : (
                        <>
                          {stat.keptApart ? <span className="muted">Kept apart from {stat.name}; rename to make a new person.</span> : null}
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
                          <span className="history-manage-actions">
                            <button
                              className="text-button"
                              type="button"
                              aria-label={`Games for ${label}`}
                              aria-expanded={isOpen}
                              aria-controls={isOpen ? gamesId : undefined}
                              onClick={() => toggleGames(stat.key)}
                            >
                              <ListTree size={14} aria-hidden="true" />
                              Games
                            </button>
                            <button
                              className="text-button"
                              type="button"
                              aria-label={`Rename ${label}`}
                              onClick={() => setRenaming({ key: stat.key, value: stat.keptApart ? "" : stat.name })}
                            >
                              <Pencil size={14} aria-hidden="true" />
                              Rename
                            </button>
                          </span>
                        </>
                      )}
                    </div>
                  ) : null}
                  {isOpen ? (
                    <HistoryGameList
                      id={gamesId}
                      row={stat}
                      entries={groupByKey.get(stat.key)?.entries ?? []}
                      directory={directory}
                      onSaved={setStatus}
                      onError={setError}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
          {!managing && rangeCurrencies.length > 0 ? (
            <TrendsBoundary>
              <Suspense fallback={<p className="history-chart-message muted" role="status">Loading charts…</p>}>
                <HistoryTrends
                  games={games}
                  rangeGames={rangeGames}
                  directory={directory}
                  currencies={rangeCurrencies}
                  rangeLabel={rangeLabel}
                />
              </Suspense>
            </TrendsBoundary>
          ) : null}
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
