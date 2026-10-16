import { DEFAULT_CURRENCY_CODE, type CurrencyCode } from "./money";
import type { GameState } from "./pokerTypes";
import {
  EMPTY_PEOPLE_DIRECTORY,
  identifyPlayer,
  indexPeople,
  isNameClaimed,
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
  /**
   * When the game was last changed after it was archived (a player relinked in
   * Player History). Restores keep whichever copy changed last
   * (archiveRevisionMs). Optional and additive: older builds ignore it.
   */
  editedAt?: string;
  /**
   * For a guest's copy of a shared room's game (state/sharedGameArchive.ts):
   * when that room closed (ended, else was created), in epoch ms. A copy from
   * a room that closed earlier never replaces it. Optional and additive.
   */
  roomClosedAt?: number;
  state: GameState;
};

/** One player's results in one currency. Amounts in different currencies are never added together. */
export type PlayerCurrencyResult = {
  currencyCode: CurrencyCode;
  games: number;
  totalNetCents: number;
  averageNetCents: number;
  biggestWinCents: number;
  biggestLossCents: number;
};

export type PlayerHistoryStat = {
  /** Stable row key: `person:<root person id>` or `name:<lowercased name>`. */
  key: string;
  /** Set for rows that belong to a person in the people directory. */
  personId?: string;
  name: string;
  /** Games across every currency. */
  games: number;
  /**
   * Results per currency: the history's main currency (historyMainCurrency) first,
   * then by games played. Never empty.
   */
  results: PlayerCurrencyResult[];
  /** Newest archive time among this row's games. */
  lastPlayedAt: string;
  /** Set on name rows whose name belongs to a person its players were marked as not being. */
  keptApart?: true;
};

/** Validates and migrates one stored archive entry; null when this build cannot read it. */
export function parseArchivedEntry(entry: unknown): ArchivedGame | null {
  if (!entry || typeof entry !== "object") return null;
  const candidate = entry as { archivedAt?: unknown; state?: unknown };
  if (typeof candidate.archivedAt !== "string" || !validatePersistedState(candidate.state)) return null;
  const editedAt = (entry as { editedAt?: unknown }).editedAt;
  const roomClosedAt = (entry as { roomClosedAt?: unknown }).roomClosedAt;
  try {
    return {
      archivedAt: candidate.archivedAt,
      // Optional: an unusable time is dropped rather than skipping the game.
      ...(typeof editedAt === "string" && Number.isFinite(Date.parse(editedAt)) ? { editedAt } : {}),
      ...(typeof roomClosedAt === "number" && Number.isFinite(roomClosedAt) ? { roomClosedAt } : {}),
      state: migratePersistedState(candidate.state)
    };
  } catch {
    return null;
  }
}

/** The plain JSON an archived game is stored and backed up as. */
export function archiveEntry(game: ArchivedGame): unknown {
  return JSON.parse(
    JSON.stringify({
      archivedAt: game.archivedAt,
      ...(game.editedAt ? { editedAt: game.editedAt } : {}),
      ...(game.roomClosedAt !== undefined ? { roomClosedAt: game.roomClosedAt } : {}),
      state: game.state
    })
  ) as unknown;
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
 * When a stored entry (or game) last changed: archived, or edited afterwards.
 * Restores and merges keep the copy with the later revision.
 */
export function archiveRevisionMs(entry: unknown): number {
  if (!entry || typeof entry !== "object") return 0;
  const { archivedAt, editedAt } = entry as { archivedAt?: unknown; editedAt?: unknown };
  return Math.max(archivedAtMs(archivedAt), archivedAtMs(editedAt));
}

/**
 * The currency most archived games were played in (ties go to the most
 * recently archived game's); US dollars when there are none.
 */
export function historyMainCurrency(games: ArchivedGame[]): CurrencyCode {
  const tally = new Map<CurrencyCode, { games: number; latestMs: number }>();
  for (const game of games) {
    const code = game.state.settings.currencyCode;
    const current = tally.get(code) ?? { games: 0, latestMs: Number.NEGATIVE_INFINITY };
    tally.set(code, {
      games: current.games + 1,
      latestMs: Math.max(current.latestMs, archivedAtMs(game.archivedAt))
    });
  }
  let best: { code: CurrencyCode; games: number; latestMs: number } | null = null;
  for (const [code, value] of tally) {
    if (!best || value.games > best.games || (value.games === best.games && value.latestMs > best.latestMs)) {
      best = { code, ...value };
    }
  }
  return best?.code ?? DEFAULT_CURRENCY_CODE;
}

/** Summarizes one currency's per-game results (at least one). */
export function currencyResult(currencyCode: CurrencyCode, results: number[]): PlayerCurrencyResult {
  const totalNetCents = results.reduce((total, result) => total + result, 0);
  return {
    currencyCode,
    games: results.length,
    totalNetCents,
    averageNetCents: Math.round(totalNetCents / results.length),
    biggestWinCents: Math.max(...results),
    biggestLossCents: Math.min(...results)
  };
}

/** One player's net result in one archived game, as grouped into a history row. */
export type PlayerGameEntry = {
  game: ArchivedGame;
  playerId: string;
  /** The name the player had in that game. */
  playerName: string;
  currencyCode: CurrencyCode;
  netCents: number;
};

/** One Player History row before money is summarized: who it is and every game they played. */
export type PlayerHistoryGroup = {
  key: string;
  personId?: string;
  name: string;
  /** In the order the games were given. */
  entries: PlayerGameEntry[];
  lastPlayedAt: string;
  keptApart?: true;
};

/**
 * Groups players across archived games into Player History rows. Players count
 * for the person they are linked to (via personId, following merges) or whose
 * name/alias they match exactly; anyone else is grouped by lowercased trimmed
 * name. Players who never took part (inactive with no transactions) are skipped.
 */
export function groupPlayerHistory(
  games: ArchivedGame[],
  directory: PeopleDirectory = EMPTY_PEOPLE_DIRECTORY
): PlayerHistoryGroup[] {
  const index = indexPeople(directory);
  const values = new Map<string, PlayerHistoryGroup & { lastPlayedMs: number }>();
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
      const key = "personId" in identity ? `person:${identity.personId}` : `name:${identity.nameKey}`;
      const current = values.get(key) ?? {
        key,
        ...("personId" in identity ? { personId: identity.personId } : {}),
        name: "personId" in identity ? index.byId.get(identity.personId)?.name ?? player.name.trim() : player.name.trim(),
        entries: [],
        lastPlayedMs: playedMs,
        lastPlayedAt: game.archivedAt
      };
      current.entries.push({
        game,
        playerId: player.id,
        playerName: player.name.trim(),
        currencyCode: game.state.settings.currencyCode,
        netCents: summaryById.get(player.id)?.netCents ?? 0
      });
      if (playedMs > current.lastPlayedMs) {
        current.lastPlayedMs = playedMs;
        current.lastPlayedAt = game.archivedAt;
        // Name rows show the most recent spelling.
        if (!current.personId) current.name = player.name.trim();
      }
      values.set(key, current);
    }
  }
  return [...values.values()].map(({ lastPlayedMs: _lastPlayedMs, ...group }) =>
    !group.personId && isNameClaimed(index, group.name) ? { ...group, keptApart: true as const } : group
  );
}

/** How a history row is shown: rows kept apart from the person with their name say so. */
export function historyRowLabel(row: { name: string; keptApart?: true }): string {
  return row.keptApart ? `${row.name} (unlinked)` : row.name;
}

/**
 * Per-person results across archived games, grouped as in groupPlayerHistory.
 * Money is grouped per currency (see PlayerHistoryStat.results); rows are
 * ordered by their total in the main currency, then rows without it by games.
 */
export function buildPlayerHistoryStats(
  games: ArchivedGame[],
  directory: PeopleDirectory = EMPTY_PEOPLE_DIRECTORY
): PlayerHistoryStat[] {
  const mainCurrency = historyMainCurrency(games);
  const mainTotal = (stat: PlayerHistoryStat): number | null =>
    stat.results[0]?.currencyCode === mainCurrency ? stat.results[0].totalNetCents : null;

  return groupPlayerHistory(games, directory).map(({ key, personId, name, entries, lastPlayedAt, keptApart }): PlayerHistoryStat => {
    const results = new Map<CurrencyCode, number[]>();
    for (const entry of entries) {
      const values = results.get(entry.currencyCode) ?? [];
      values.push(entry.netCents);
      results.set(entry.currencyCode, values);
    }
    const byCurrency = [...results.entries()]
      .map(([currencyCode, values]) => currencyResult(currencyCode, values))
      .sort(
        (left, right) =>
          Number(right.currencyCode === mainCurrency) - Number(left.currencyCode === mainCurrency) ||
          right.games - left.games ||
          left.currencyCode.localeCompare(right.currencyCode)
      );
    return {
      key,
      ...(personId ? { personId } : {}),
      name,
      games: byCurrency.reduce((total, result) => total + result.games, 0),
      results: byCurrency,
      lastPlayedAt,
      ...(keptApart ? { keptApart } : {})
    };
  }).sort((left, right) => {
    const leftTotal = mainTotal(left);
    const rightTotal = mainTotal(right);
    if (leftTotal !== null && rightTotal !== null) return rightTotal - leftTotal;
    if (leftTotal !== null) return -1;
    if (rightTotal !== null) return 1;
    return right.games - left.games || left.name.localeCompare(right.name);
  });
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
    // Rows kept apart from the person with their name would only link that person again.
    .filter((stat) => stat.personId || (!isPlaceholderName(stat.name) && !stat.keptApart))
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
