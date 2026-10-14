/**
 * The device-local people directory: stable identities for players across games.
 *
 * A game's Player may carry a `personId`. Names still matter: a player without a
 * (known) personId belongs to the person whose display name or alias matches
 * its name exactly (case-insensitive), but only when exactly one person matches.
 * Merging never happens silently beyond that exact-match rule.
 *
 * Merges are reversible: a merged person keeps its record and points at the
 * person it was merged into (`mergedIntoId`), and merged-in legacy names are
 * kept as aliases that can be separated again. This module is pure.
 */
import { hasPlayerTransactions } from "./ledger";
import type { GameState, Player, Transaction } from "./pokerTypes";
import { isValidVenmoHandle, normalizeVenmoHandle } from "./venmo";

export const PEOPLE_SCHEMA_VERSION = 1;
export const MAX_PERSON_NAME_LENGTH = 80;
const PERSON_ID_PATTERN = /^[A-Za-z0-9_-]{1,160}$/;
const PLACEHOLDER_NAME_PATTERN = /^player \d+$/i;
const MAX_ALIASES = 100;

export type Person = {
  id: string;
  name: string;
  /** Other names (display spelling) that belong to this person, e.g. merged legacy names. */
  aliases: string[];
  /** Set when this person was merged into another; cleared again by separating it. */
  mergedIntoId?: string;
  /** Venmo username (without @), remembered for settlement pay links in later games. */
  venmoHandle?: string;
  createdAt: string;
  updatedAt: string;
};

export type PeopleDirectory = {
  schemaVersion: typeof PEOPLE_SCHEMA_VERSION;
  people: Person[];
};

export const EMPTY_PEOPLE_DIRECTORY: PeopleDirectory = { schemaVersion: PEOPLE_SCHEMA_VERSION, people: [] };

export type PeopleResult = { directory: PeopleDirectory; personId: string } | { error: string };

export function nameKey(name: string): string {
  return name.trim().toLocaleLowerCase();
}

export function isValidPersonId(value: unknown): value is string {
  return typeof value === "string" && PERSON_ID_PATTERN.test(value);
}

/** Default "Player N" names never create or match people automatically. */
export function isPlaceholderName(name: string): boolean {
  return PLACEHOLDER_NAME_PATTERN.test(name.trim());
}

/** Players that actually took part: seated at the end, or involved in any transaction. */
export function playerParticipated(player: Player, transactions: Transaction[]): boolean {
  return player.isActive || hasPlayerTransactions(player.id, transactions);
}

function cleanName(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, MAX_PERSON_NAME_LENGTH);
}

function parsePerson(value: unknown): Person | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<Record<keyof Person, unknown>>;
  if (!isValidPersonId(candidate.id) || typeof candidate.name !== "string") return null;
  const name = cleanName(candidate.name);
  if (!name) return null;
  if (candidate.aliases !== undefined && !Array.isArray(candidate.aliases)) return null;
  if (candidate.mergedIntoId !== undefined && !isValidPersonId(candidate.mergedIntoId)) return null;
  const createdAt = typeof candidate.createdAt === "string" ? candidate.createdAt : new Date(0).toISOString();
  // Optional and additive: an unusable handle is dropped rather than skipping the person.
  const venmoHandle = normalizeVenmoHandle(candidate.venmoHandle);
  return {
    id: candidate.id,
    name,
    aliases: (candidate.aliases ?? []).filter((alias): alias is string => typeof alias === "string"),
    ...(candidate.mergedIntoId ? { mergedIntoId: candidate.mergedIntoId } : {}),
    ...(venmoHandle ? { venmoHandle } : {}),
    createdAt,
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : createdAt
  };
}

/**
 * Reads a stored or imported directory. Null when the value is not a directory
 * this build understands (including a newer schema); otherwise the readable
 * people plus the raw entries that had to be skipped.
 */
export function parsePeopleDirectory(value: unknown): { directory: PeopleDirectory; skipped: unknown[] } | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { schemaVersion?: unknown; people?: unknown };
  if (candidate.schemaVersion !== PEOPLE_SCHEMA_VERSION || !Array.isArray(candidate.people)) return null;
  const skipped: unknown[] = [];
  const people = candidate.people.flatMap((entry) => {
    const person = parsePerson(entry);
    if (!person) skipped.push(entry);
    return person ? [person] : [];
  });
  return { directory: normalizePeopleDirectory(people), skipped };
}

/** Dedupes ids and aliases, and drops merge links that dangle or form a cycle. */
export function normalizePeopleDirectory(people: Person[]): PeopleDirectory {
  const byId = new Map<string, Person>();
  for (const person of people) {
    if (byId.has(person.id)) continue;
    const name = cleanName(person.name);
    // An alias may repeat the display name: that explicitly claims a name other people share.
    const seen = new Set<string>();
    const aliases: string[] = [];
    for (const alias of person.aliases) {
      const cleaned = cleanName(alias);
      const key = nameKey(cleaned);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      aliases.push(cleaned);
    }
    const { mergedIntoId: _mergedIntoId, ...rest } = person;
    byId.set(person.id, {
      ...rest,
      name,
      aliases: aliases.slice(0, MAX_ALIASES),
      ...(person.mergedIntoId && person.mergedIntoId !== person.id ? { mergedIntoId: person.mergedIntoId } : {})
    });
  }
  for (const person of byId.values()) {
    if (person.mergedIntoId && !byId.has(person.mergedIntoId)) delete person.mergedIntoId;
  }
  for (const start of byId.values()) {
    const visited = new Set<string>();
    let current: Person | undefined = start;
    while (current?.mergedIntoId) {
      visited.add(current.id);
      if (visited.has(current.mergedIntoId)) {
        delete current.mergedIntoId;
        break;
      }
      current = byId.get(current.mergedIntoId);
    }
  }
  return { schemaVersion: PEOPLE_SCHEMA_VERSION, people: [...byId.values()] };
}

export type NameMatch =
  | { kind: "none" }
  | { kind: "match"; personId: string }
  | { kind: "ambiguous"; personIds: string[] };

export type PeopleIndex = {
  directory: PeopleDirectory;
  byId: Map<string, Person>;
  /** The person a (possibly merged) id currently belongs to; undefined for unknown ids. */
  rootId: (personId: string) => string | undefined;
  root: (personId: string) => Person | undefined;
  lookupName: (name: string) => NameMatch;
  /** People merged directly into this one. */
  mergedInto: (personId: string) => Person[];
};

const indexCache = new WeakMap<PeopleDirectory, PeopleIndex>();

export function indexPeople(directory: PeopleDirectory): PeopleIndex {
  const cached = indexCache.get(directory);
  if (cached) return cached;
  const byId = new Map(directory.people.map((person) => [person.id, person]));
  const rootIds = new Map<string, string>();
  const rootId = (personId: string): string | undefined => {
    const known = rootIds.get(personId);
    if (known) return known;
    let current = byId.get(personId);
    if (!current) return undefined;
    const visited = new Set<string>();
    while (current.mergedIntoId && !visited.has(current.id)) {
      visited.add(current.id);
      const next = byId.get(current.mergedIntoId);
      if (!next) break;
      current = next;
    }
    rootIds.set(personId, current.id);
    return current.id;
  };
  const aliasRoots = new Map<string, Set<string>>();
  const nameRoots = new Map<string, Set<string>>();
  const children = new Map<string, Person[]>();
  const add = (map: Map<string, Set<string>>, key: string, id: string) => {
    if (!key) return;
    const set = map.get(key) ?? new Set<string>();
    set.add(id);
    map.set(key, set);
  };
  for (const person of directory.people) {
    const root = rootId(person.id) ?? person.id;
    add(nameRoots, nameKey(person.name), root);
    for (const alias of person.aliases) add(aliasRoots, nameKey(alias), root);
    if (person.mergedIntoId && byId.has(person.mergedIntoId)) {
      children.set(person.mergedIntoId, [...(children.get(person.mergedIntoId) ?? []), person]);
    }
  }
  const pick = (set: Set<string> | undefined): NameMatch | null => {
    if (!set || set.size === 0) return null;
    const ids = [...set];
    return ids.length === 1 ? { kind: "match", personId: ids[0] } : { kind: "ambiguous", personIds: ids };
  };
  const index: PeopleIndex = {
    directory,
    byId,
    rootId,
    root: (personId) => {
      const id = rootId(personId);
      return id ? byId.get(id) : undefined;
    },
    // Explicit aliases (from merges) win over display names, so a merge can settle an ambiguous name.
    lookupName: (name) => {
      const key = nameKey(name);
      if (!key) return { kind: "none" };
      const byAlias = pick(aliasRoots.get(key));
      if (byAlias?.kind === "match") return byAlias;
      const byName = pick(nameRoots.get(key));
      if (byName?.kind === "match" && !byAlias) return byName;
      if (byAlias || byName) {
        const ids = new Set([...(aliasRoots.get(key) ?? []), ...(nameRoots.get(key) ?? [])]);
        return { kind: "ambiguous", personIds: [...ids] };
      }
      return { kind: "none" };
    },
    mergedInto: (personId) => children.get(personId) ?? []
  };
  indexCache.set(directory, index);
  return index;
}

/** Every name (display or alias, including merged people) that resolves to this root. */
function groupKeys(index: PeopleIndex, rootPersonId: string): Set<string> {
  const keys = new Set<string>();
  for (const person of index.directory.people) {
    if (index.rootId(person.id) !== rootPersonId) continue;
    keys.add(nameKey(person.name));
    for (const alias of person.aliases) keys.add(nameKey(alias));
  }
  return keys;
}

/**
 * The person a player entry should link to when its name is committed:
 * keeps the current link while the name still belongs to that person,
 * otherwise links an exact, unambiguous name/alias match, otherwise none.
 */
export function resolvePersonForName(
  directory: PeopleDirectory,
  name: string,
  currentPersonId?: string
): string | null {
  const index = indexPeople(directory);
  const key = nameKey(name);
  if (!key) return currentPersonId ?? null;
  if (currentPersonId) {
    const root = index.rootId(currentPersonId);
    if (root && groupKeys(index, root).has(key)) return currentPersonId;
  }
  if (isPlaceholderName(name)) return null;
  const match = index.lookupName(name);
  return match.kind === "match" ? match.personId : null;
}

export type PlayerIdentity = { personId: string } | { nameKey: string };

/** The history row a player of an archived game belongs to; null for blank names. */
export function identifyPlayer(index: PeopleIndex, player: Player): PlayerIdentity | null {
  if (player.personId) {
    const root = index.rootId(player.personId);
    if (root) return { personId: root };
  }
  const key = nameKey(player.name);
  if (!key) return null;
  if (!isPlaceholderName(player.name)) {
    const match = index.lookupName(player.name);
    if (match.kind === "match") return { personId: index.rootId(match.personId) ?? match.personId };
  }
  return { nameKey: key };
}

function nameConflict(index: PeopleIndex, name: string, allowedRoots: Set<string>): string | null {
  const match = index.lookupName(name);
  const ids = match.kind === "match" ? [match.personId] : match.kind === "ambiguous" ? match.personIds : [];
  const other = ids.map((id) => index.root(id)).find((person) => person && !allowedRoots.has(person.id));
  return other ? `${other.name} already uses the name ${cleanName(name)}. Pick a different name, or merge them.` : null;
}

function validateName(name: string): string | null {
  const cleaned = cleanName(name);
  if (!cleaned) return "Enter a name.";
  if (name.trim().length > MAX_PERSON_NAME_LENGTH) return `Names can be at most ${MAX_PERSON_NAME_LENGTH} characters.`;
  return null;
}

/** Renames in place, keeping the old name as an alias so games matched by it stay with this person. */
function withName(person: Person, name: string, now: string): Person {
  const cleaned = cleanName(name);
  if (cleaned === person.name) return person;
  const changedKey = nameKey(cleaned) !== nameKey(person.name);
  return {
    ...person,
    name: cleaned,
    aliases: changedKey
      ? [...person.aliases.filter((alias) => nameKey(alias) !== nameKey(cleaned)), person.name]
      : person.aliases,
    updatedAt: now
  };
}

function replacePeople(directory: PeopleDirectory, changed: Person[], added: Person[] = []): PeopleDirectory {
  const byId = new Map(changed.map((person) => [person.id, person]));
  return normalizePeopleDirectory([
    ...directory.people.map((person) => byId.get(person.id) ?? person),
    ...added
  ]);
}

export function createPerson(
  directory: PeopleDirectory,
  name: string,
  now: string,
  id: string
): PeopleResult {
  const invalid = validateName(name) ?? nameConflict(indexPeople(directory), name, new Set());
  if (invalid) return { error: invalid };
  const person: Person = { id, name: cleanName(name), aliases: [], createdAt: now, updatedAt: now };
  return { directory: replacePeople(directory, [], [person]), personId: id };
}

export function renamePerson(
  directory: PeopleDirectory,
  personId: string,
  name: string,
  now: string
): PeopleResult {
  const index = indexPeople(directory);
  const person = index.root(personId);
  if (!person) return { error: "That person no longer exists." };
  // A change of letter case only cannot introduce a new clash.
  const invalid = validateName(name) ??
    (nameKey(name) === nameKey(person.name) ? null : nameConflict(index, name, new Set([person.id])));
  if (invalid) return { error: invalid };
  return { directory: replacePeople(directory, [withName(person, name, now)]), personId: person.id };
}

/** A Player History row to merge: a person, or a name no person claims yet. */
export type MergeSource = { personId: string } | { name: string };

/**
 * Merges history rows into one person named `name`. The first person among the
 * sources keeps its id (a new person is created when only names are merged);
 * other people are linked to it and names become its aliases.
 */
export function mergeIntoPerson(
  directory: PeopleDirectory,
  sources: MergeSource[],
  name: string,
  now: string,
  newId: string
): PeopleResult {
  const index = indexPeople(directory);
  const roots = [
    ...new Set(
      sources.flatMap((source) => {
        if (!("personId" in source)) return [];
        const root = index.rootId(source.personId);
        return root ? [root] : [];
      })
    )
  ];
  const names = sources.flatMap((source) => ("name" in source && nameKey(source.name) ? [cleanName(source.name)] : []));
  if (roots.length + names.length < 2 && !(roots.length === 0 && names.length === 1)) {
    return { error: "Choose at least two players to merge." };
  }
  const keepsTargetName = roots.length > 0 && nameKey(name) === nameKey(index.byId.get(roots[0])!.name);
  const invalid = validateName(name) ?? (keepsTargetName ? null : nameConflict(index, name, new Set(roots)));
  if (invalid) return { error: invalid };

  const target: Person = roots.length > 0
    ? index.byId.get(roots[0])!
    : { id: newId, name: cleanName(name), aliases: [], createdAt: now, updatedAt: now };
  const mergedKeys = new Set(names.map(nameKey));
  const changed: Person[] = [];
  for (const person of directory.people) {
    if (person.id === target.id) continue;
    const isMergedRoot = roots.includes(person.id);
    // A merged name now means this person; take it away from anyone else's aliases.
    const aliases = person.aliases.filter((alias) => !mergedKeys.has(nameKey(alias)));
    if (isMergedRoot || aliases.length !== person.aliases.length) {
      changed.push({
        ...person,
        aliases,
        ...(isMergedRoot ? { mergedIntoId: target.id } : {}),
        updatedAt: now
      });
    }
  }
  const renamed = withName(target, name, now);
  // The display name already matches its own key unless other people share it.
  const ownKey = nameKey(renamed.name);
  const sharedOwnName = index.lookupName(renamed.name).kind === "ambiguous";
  const updatedTarget: Person = {
    ...renamed,
    aliases: [...renamed.aliases, ...names.filter((merged) => nameKey(merged) !== ownKey || sharedOwnName)],
    updatedAt: now
  };
  const isNew = roots.length === 0;
  return {
    directory: replacePeople(directory, isNew ? changed : [...changed, updatedTarget], isNew ? [updatedTarget] : []),
    personId: target.id
  };
}

/**
 * The Venmo username remembered for a person: its own, or else one from a
 * person merged into it.
 */
export function personVenmoHandle(index: PeopleIndex, personId: string): string | undefined {
  const root = index.root(personId);
  if (!root) return undefined;
  if (root.venmoHandle) return root.venmoHandle;
  return index.directory.people.find(
    (person) => person.venmoHandle && index.rootId(person.id) === root.id
  )?.venmoHandle;
}

/** Sets (or, with null, clears) a person's Venmo username; unchanged when invalid or the same. */
export function setPersonVenmoHandle(
  directory: PeopleDirectory,
  personId: string,
  handle: string | null,
  now: string
): PeopleDirectory {
  const person = indexPeople(directory).root(personId);
  if (!person) return directory;
  const venmoHandle = handle === null ? null : normalizeVenmoHandle(handle);
  if (handle !== null && !venmoHandle) return directory;
  if ((person.venmoHandle ?? null) === venmoHandle) return directory;
  const { venmoHandle: _venmoHandle, ...rest } = person;
  return replacePeople(directory, [{ ...rest, ...(venmoHandle ? { venmoHandle } : {}), updatedAt: now }]);
}

/**
 * The Venmo username a player entry should get when its person link is set
 * to `nextPersonId`: the person's remembered username when the link changes
 * (null, clearing it, when that person has none or there is no link), or the
 * person's username when the player has none yet. Undefined means keep the
 * player's current username.
 */
export function venmoHandleForLink(
  directory: PeopleDirectory,
  player: Pick<Player, "personId" | "venmoHandle"> | undefined,
  nextPersonId: string | null
): string | null | undefined {
  const index = indexPeople(directory);
  const remembered = nextPersonId ? personVenmoHandle(index, nextPersonId) ?? null : null;
  const previousPersonId = player?.personId ?? null;
  if (previousPersonId !== nextPersonId) return remembered;
  if (!player?.venmoHandle && remembered) return remembered;
  return undefined;
}

/** Separates a merged-in name: games matched only by that name stop counting for this person. */
export function separateAlias(
  directory: PeopleDirectory,
  personId: string,
  alias: string,
  now: string
): PeopleDirectory {
  const key = nameKey(alias);
  const person = directory.people.find((candidate) => candidate.id === personId);
  if (!person || !person.aliases.some((candidate) => nameKey(candidate) === key)) return directory;
  return replacePeople(directory, [
    { ...person, aliases: person.aliases.filter((candidate) => nameKey(candidate) !== key), updatedAt: now }
  ]);
}

/** Undoes merging a person into another; it becomes its own row again. */
export function separatePerson(directory: PeopleDirectory, personId: string, now: string): PeopleDirectory {
  const person = directory.people.find((candidate) => candidate.id === personId);
  if (!person?.mergedIntoId) return directory;
  const { mergedIntoId: _mergedIntoId, ...rest } = person;
  return replacePeople(directory, [{ ...rest, updatedAt: now }]);
}

/**
 * Restores people from a backup. The same person (same id) keeps the newer
 * name and merge state and gains the other copy's aliases. A new person whose
 * name exactly matches exactly one person here is merged into them (reversible).
 */
export function mergePeopleDirectories(local: PeopleDirectory, incoming: PeopleDirectory): PeopleDirectory {
  const localIndex = indexPeople(local);
  const byId = new Map(local.people.map((person) => [person.id, person]));
  const added: Person[] = [];
  for (const person of incoming.people) {
    const existing = byId.get(person.id);
    if (existing) {
      const newer = Date.parse(person.updatedAt) > Date.parse(existing.updatedAt) ? person : existing;
      byId.set(person.id, {
        ...newer,
        aliases: [...newer.aliases, ...(newer === person ? existing.aliases : person.aliases)],
        createdAt: Date.parse(person.createdAt) < Date.parse(existing.createdAt) ? person.createdAt : existing.createdAt,
        updatedAt: newer.updatedAt
      });
      continue;
    }
    const match = person.mergedIntoId ? null : localIndex.lookupName(person.name);
    added.push(match?.kind === "match" ? { ...person, mergedIntoId: match.personId } : person);
  }
  return normalizePeopleDirectory([...byId.values(), ...added]);
}

/**
 * Links the players of a finished game to people before it enters Player History.
 * Known links stay; exact unambiguous name matches are linked; other real names
 * become new people (reusing an unknown personId the player already carries, so
 * an id from another device's export survives). Placeholder names, ambiguous
 * names, and players who never took part are left alone.
 */
export function linkGamePlayers(
  state: GameState,
  directory: PeopleDirectory,
  now: string,
  /** Null links existing people only. */
  createPersonId: (() => string) | null
): { state: GameState; directory: PeopleDirectory } {
  let current = directory;
  let changed = false;
  const players = state.players.map((player) => {
    if (!playerParticipated(player, state.transactions)) return player;
    const index = indexPeople(current);
    if (player.personId && index.rootId(player.personId)) return player;
    const name = cleanName(player.name);
    if (!name || isPlaceholderName(name)) return player;
    const match = index.lookupName(name);
    if (match.kind === "ambiguous") return player;
    if (match.kind === "match") {
      changed = true;
      return { ...player, personId: match.personId };
    }
    if (!createPersonId) return player;
    const id = isValidPersonId(player.personId) && !index.byId.has(player.personId)
      ? player.personId
      : createPersonId();
    const created = createPerson(current, name, now, id);
    if ("error" in created) return player;
    changed = true;
    current = created.directory;
    return { ...player, personId: id };
  });
  // Remember usernames entered during the game for people who have none yet.
  for (const player of players) {
    if (!player.personId || !isValidVenmoHandle(player.venmoHandle)) continue;
    if (personVenmoHandle(indexPeople(current), player.personId)) continue;
    current = setPersonVenmoHandle(current, player.personId, player.venmoHandle, now);
  }
  return changed ? { state: { ...state, players }, directory: current } : { state, directory: current };
}
