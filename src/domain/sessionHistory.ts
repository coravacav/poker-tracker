import type { GameState } from "./pokerTypes";
import {
  EMPTY_PEOPLE_DIRECTORY,
  identifyPlayer,
  indexPeople,
  isPlaceholderName,
  nameKey,
  playerParticipated,
  type PeopleDirectory
} from "./people";
import { buildPlayerSummaries } from "./ledger";
import { migratePersistedState } from "../state/persistence";
import { validatePersistedState } from "./validation";

/** Storage and change notifications live in state/gameArchive.ts; this module stays pure. */
export type ArchivedGame = {
  archivedAt: string;
  state: GameState;
};

export type PlayerHistoryStat = {
  /** Stable row key: `person:<root person id>` or `name:<lowercased name>`. */
  key: string;
  /** Set for rows that belong to a person in the people directory. */
  personId?: string;
  name: string;
  games: number;
  totalNetCents: number;
  averageNetCents: number;
  biggestWinCents: number;
  biggestLossCents: number;
  /** Newest archive time among this row's games. */
  lastPlayedAt: string;
};

/** Validates and migrates one stored archive entry; null when this build cannot read it. */
export function parseArchivedEntry(entry: unknown): ArchivedGame | null {
  if (!entry || typeof entry !== "object") return null;
  const candidate = entry as { archivedAt?: unknown; state?: unknown };
  if (typeof candidate.archivedAt !== "string" || !validatePersistedState(candidate.state)) return null;
  try {
    return { archivedAt: candidate.archivedAt, state: migratePersistedState(candidate.state) };
  } catch {
    return null;
  }
}

export function parseArchivedGames(value: unknown): ArchivedGame[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => parseArchivedEntry(entry) ?? []);
}

/** Epoch milliseconds of an archive timestamp; 0 when it is missing or unparseable. */
export function archivedAtMs(archivedAt: unknown): number {
  return typeof archivedAt === "string" ? Date.parse(archivedAt) || 0 : 0;
}

/**
 * Per-person results across archived games. Players count for the person they
 * are linked to (via personId, following merges) or whose name/alias they match
 * exactly; anyone else is grouped by lowercased trimmed name as before.
 * Players who never took part (inactive with no transactions) are skipped.
 */
export function buildPlayerHistoryStats(
  games: ArchivedGame[],
  directory: PeopleDirectory = EMPTY_PEOPLE_DIRECTORY
): PlayerHistoryStat[] {
  const index = indexPeople(directory);
  const values = new Map<
    string,
    { personId?: string; name: string; results: number[]; lastPlayedMs: number; lastPlayedAt: string }
  >();
  for (const game of games) {
    const summaryById = new Map(
      buildPlayerSummaries(game.state.players, game.state.transactions)
        .map((summary) => [summary.playerId, summary])
    );
    const playedMs = archivedAtMs(game.archivedAt);
    for (const player of game.state.players) {
      if (!playerParticipated(player, game.state.transactions)) continue;
      const identity = identifyPlayer(index, player);
      if (!identity) continue;
      const result = summaryById.get(player.id)?.netCents ?? 0;
      const key = "personId" in identity ? `person:${identity.personId}` : `name:${identity.nameKey}`;
      const current = values.get(key) ?? {
        ...("personId" in identity ? { personId: identity.personId } : {}),
        name: "personId" in identity ? index.byId.get(identity.personId)?.name ?? player.name.trim() : player.name.trim(),
        results: [],
        lastPlayedMs: playedMs,
        lastPlayedAt: game.archivedAt
      };
      current.results.push(result);
      if (playedMs > current.lastPlayedMs) {
        current.lastPlayedMs = playedMs;
        current.lastPlayedAt = game.archivedAt;
        // Name rows show the most recent spelling.
        if (!current.personId) current.name = player.name.trim();
      }
      values.set(key, current);
    }
  }

  return [...values.entries()].map(([key, { personId, name, results, lastPlayedAt }]) => {
    const totalNetCents = results.reduce((total, result) => total + result, 0);
    return {
      key,
      ...(personId ? { personId } : {}),
      name,
      games: results.length,
      totalNetCents,
      averageNetCents: Math.round(totalNetCents / results.length),
      biggestWinCents: Math.max(...results),
      biggestLossCents: Math.min(...results),
      lastPlayedAt
    };
  }).sort((left, right) => right.totalNetCents - left.totalNetCents);
}

export type PersonSuggestion = {
  key: string;
  personId?: string;
  name: string;
  games: number;
  /** Lowercased names (display and aliases) the suggestion can be found by. */
  searchKeys: string[];
};

/**
 * Names to offer when entering players: people and earlier players from Player
 * History, most recently played first, then most games. People with no
 * archived games yet come last.
 */
export function buildPersonSuggestions(
  stats: PlayerHistoryStat[],
  directory: PeopleDirectory
): PersonSuggestion[] {
  const index = indexPeople(directory);
  const keysFor = (personId: string): string[] => [
    ...new Set(
      directory.people
        .filter((person) => index.rootId(person.id) === personId)
        .flatMap((person) => [person.name, ...person.aliases].map(nameKey))
    )
  ];
  const ranked = [...stats]
    .filter((stat) => stat.personId || !isPlaceholderName(stat.name))
    .sort(
      (left, right) =>
        archivedAtMs(right.lastPlayedAt) - archivedAtMs(left.lastPlayedAt) ||
        right.games - left.games ||
        left.name.localeCompare(right.name)
    )
    .map((stat): PersonSuggestion => ({
      key: stat.key,
      ...(stat.personId ? { personId: stat.personId } : {}),
      name: stat.name,
      games: stat.games,
      searchKeys: stat.personId ? keysFor(stat.personId) : [nameKey(stat.name)]
    }));
  const listed = new Set(ranked.flatMap((suggestion) => suggestion.personId ?? []));
  const unplayed = directory.people
    .filter((person) => !person.mergedIntoId && !listed.has(person.id))
    .sort((left, right) => archivedAtMs(right.updatedAt) - archivedAtMs(left.updatedAt))
    .map((person): PersonSuggestion => ({
      key: `person:${person.id}`,
      personId: person.id,
      name: person.name,
      games: 0,
      searchKeys: keysFor(person.id)
    }));
  return [...ranked, ...unplayed];
}

/**
 * Suggestions matching typed text (a prefix of any word of a name or alias),
 * excluding people and names already in use. Blank or "Player N" text browses
 * the most recent people.
 */
export function filterPersonSuggestions(
  suggestions: PersonSuggestion[],
  query: string,
  exclude: { personIds: Set<string>; nameKeys: Set<string> },
  limit = 4
): PersonSuggestion[] {
  const typed = nameKey(query);
  const browsing = !typed || isPlaceholderName(query);
  return suggestions
    .filter((suggestion) => {
      if (suggestion.personId && exclude.personIds.has(suggestion.personId)) return false;
      if (suggestion.searchKeys.some((key) => exclude.nameKeys.has(key))) return false;
      if (browsing) return true;
      // Typing a name in full already links it; only people still need offering then (several may share it).
      if (!suggestion.personId && suggestion.searchKeys[0] === typed) return false;
      return suggestion.searchKeys.some(
        (key) => key.startsWith(typed) || key.split(" ").some((word) => word.startsWith(typed))
      );
    })
    .slice(0, limit);
}
