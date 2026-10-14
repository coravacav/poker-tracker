import { describe, expect, it } from "vitest";
import {
  EMPTY_PEOPLE_DIRECTORY,
  createPerson,
  indexPeople,
  linkGamePlayers,
  mergeIntoPerson,
  mergePeopleDirectories,
  normalizePeopleDirectory,
  parsePeopleDirectory,
  renamePerson,
  resolvePersonForName,
  separateAlias,
  separatePerson,
  type PeopleDirectory,
  type PeopleResult,
  type Person
} from "../domain/people";
import type { ArchivedGame } from "../domain/sessionHistory";
import {
  buildPersonSuggestions,
  buildPlayerHistoryStats,
  filterPersonSuggestions
} from "../domain/sessionHistory";
import type { Player } from "../domain/pokerTypes";
import { createDefaultGameState } from "../state/seedGame";

const NOW = "2026-10-14T12:00:00.000Z";

function person(id: string, name: string, extra: Partial<Person> = {}): Person {
  return { id, name, aliases: [], createdAt: NOW, updatedAt: NOW, ...extra };
}

function directory(...people: Person[]): PeopleDirectory {
  return normalizePeopleDirectory(people);
}

function ok(result: PeopleResult): PeopleDirectory {
  if ("error" in result) throw new Error(result.error);
  return result.directory;
}

/** A game where each named player bought in for `amount` cents (net = -amount). */
function game(
  archivedAt: string,
  players: Array<{ name: string; personId?: string; buyInCents?: number; isActive?: boolean }>
): ArchivedGame {
  const state = createDefaultGameState();
  state.players = players.map((entry, index): Player => ({
    id: `p${index}`,
    name: entry.name,
    seatIndex: index,
    isActive: entry.isActive ?? true,
    ...(entry.personId ? { personId: entry.personId } : {})
  }));
  state.transactions = players.flatMap((entry, index) =>
    entry.buyInCents
      ? [{ id: `t${index}`, type: "bank_buy_in" as const, toPlayerId: `p${index}`, amountCents: entry.buyInCents, createdAt: archivedAt }]
      : []
  );
  return { archivedAt, state };
}

describe("people directory", () => {
  it("links exact case-insensitive name or alias matches, but never ambiguous ones", () => {
    const people = directory(
      person("person_mike", "Mike", { aliases: ["Michael"] }),
      person("person_sam_a", "Sam"),
      person("person_sam_b", "Sam")
    );
    expect(resolvePersonForName(people, "  mike ")).toBe("person_mike");
    expect(resolvePersonForName(people, "MICHAEL")).toBe("person_mike");
    expect(resolvePersonForName(people, "Mik")).toBeNull();
    expect(resolvePersonForName(people, "Sam")).toBeNull();
    expect(indexPeople(people).lookupName("sam")).toEqual({ kind: "ambiguous", personIds: ["person_sam_a", "person_sam_b"] });
    // An explicit pick between namesakes is kept while the name still fits.
    expect(resolvePersonForName(people, "sam", "person_sam_b")).toBe("person_sam_b");
    // Typing a different name drops a link that no longer fits.
    expect(resolvePersonForName(people, "Alex", "person_mike")).toBeNull();
    expect(resolvePersonForName(people, "Player 3")).toBeNull();
  });

  it("merges rows into one person and separates them again", () => {
    let people = directory(person("person_mike", "Mike"), person("person_mikey", "Mikey"));
    const merged = mergeIntoPerson(people, [{ personId: "person_mike" }, { personId: "person_mikey" }, { name: "M." }], "Michael", NOW, "person_new");
    people = ok(merged);
    expect("personId" in merged && merged.personId).toBe("person_mike");
    const index = indexPeople(people);
    expect(index.rootId("person_mikey")).toBe("person_mike");
    expect(index.byId.get("person_mike")).toMatchObject({ name: "Michael", aliases: ["Mike", "M."] });
    expect(resolvePersonForName(people, "mikey")).toBe("person_mike");
    expect(resolvePersonForName(people, "m.")).toBe("person_mike");

    people = separatePerson(people, "person_mikey", NOW);
    expect(indexPeople(people).rootId("person_mikey")).toBe("person_mikey");
    people = separateAlias(people, "person_mike", "m.", NOW);
    expect(resolvePersonForName(people, "M.")).toBeNull();
    expect(resolvePersonForName(people, "Mike")).toBe("person_mike");
  });

  it("creates a person when merging names only, and settles an ambiguous name by alias", () => {
    let people = ok(mergeIntoPerson(EMPTY_PEOPLE_DIRECTORY, [{ name: "Jo" }, { name: "Joanna" }], "Joanna", NOW, "person_jo"));
    expect(people.people).toEqual([expect.objectContaining({ id: "person_jo", name: "Joanna", aliases: ["Jo"] })]);

    people = directory(person("person_sam_a", "Sam"), person("person_sam_b", "Sam"));
    people = ok(mergeIntoPerson(people, [{ personId: "person_sam_a" }, { name: "Sam" }], "Sam", NOW, "unused"));
    expect(resolvePersonForName(people, "sam")).toBe("person_sam_a");
  });

  it("rejects names another person already uses and keeps old names as aliases on rename", () => {
    let people = directory(person("person_a", "Alex"), person("person_b", "Blair"));
    expect(renamePerson(people, "person_a", "blair", NOW)).toEqual({ error: expect.stringMatching(/Blair already uses/) });
    expect(createPerson(people, "ALEX", NOW, "person_c")).toEqual({ error: expect.any(String) });
    expect(mergeIntoPerson(people, [{ personId: "person_a" }, { name: "Al" }], "Blair", NOW, "x")).toEqual({ error: expect.any(String) });
    people = ok(renamePerson(people, "person_a", "Alexander", NOW));
    expect(indexPeople(people).byId.get("person_a")).toMatchObject({ name: "Alexander", aliases: ["Alex"] });
    expect(resolvePersonForName(people, "alex")).toBe("person_a");
    // Case-only renames never clash.
    expect(ok(renamePerson(people, "person_b", "BLAIR", NOW)).people[1].name).toBe("BLAIR");
  });

  it("drops dangling and cyclic merge links and duplicate aliases when reading", () => {
    const parsed = parsePeopleDirectory({
      schemaVersion: 1,
      people: [
        person("person_a", "A", { mergedIntoId: "person_b", aliases: ["a", "Ay", "AY"] }),
        person("person_b", "B", { mergedIntoId: "person_a" }),
        person("person_c", "C", { mergedIntoId: "person_missing" }),
        { id: "bad id!", name: "Nope" },
        { id: "person_d", name: "  " }
      ]
    });
    expect(parsed?.skipped).toHaveLength(2);
    const index = indexPeople(parsed!.directory);
    expect(index.byId.get("person_a")?.aliases).toEqual(["a", "Ay"]);
    expect(index.byId.get("person_c")?.mergedIntoId).toBeUndefined();
    expect(new Set([index.rootId("person_a"), index.rootId("person_b")]).size).toBe(1);
    expect(parsePeopleDirectory({ schemaVersion: 2, people: [] })).toBeNull();
  });

  it("merges restored people by id and links new exact namesakes reversibly", () => {
    const local = directory(person("person_a", "Alex", { updatedAt: "2026-01-01T00:00:00.000Z" }), person("person_m", "Mike"));
    const incoming = directory(
      person("person_a", "Alexander", { aliases: ["Al"], updatedAt: "2026-02-01T00:00:00.000Z" }),
      person("person_other_mike", "mike"),
      person("person_z", "Zed")
    );
    const merged = mergePeopleDirectories(local, incoming);
    const index = indexPeople(merged);
    expect(index.byId.get("person_a")).toMatchObject({ name: "Alexander", aliases: ["Al"] });
    expect(index.rootId("person_other_mike")).toBe("person_m");
    expect(index.rootId("person_z")).toBe("person_z");
    expect(mergePeopleDirectories(merged, incoming)).toEqual(merged);
  });

  it("links a finished game's players and creates people for new names", () => {
    const people = directory(person("person_alex", "Alex"), person("person_s1", "Sam"), person("person_s2", "Sam"));
    const { state } = game(NOW, [
      { name: "alex", buyInCents: 100 },
      { name: "Blair", buyInCents: 100 },
      { name: "Sam", buyInCents: 100 },
      { name: "Player 4", buyInCents: 100 },
      { name: "Casey", isActive: false },
      { name: "Dana", personId: "person_from_elsewhere", buyInCents: 100 }
    ]);
    let next = 0;
    const linked = linkGamePlayers(state, people, NOW, () => `person_new${++next}`);
    expect(linked.state.players.map((player) => player.personId)).toEqual([
      "person_alex",
      "person_new1",
      undefined,
      undefined,
      undefined,
      "person_from_elsewhere"
    ]);
    expect(indexPeople(linked.directory).byId.get("person_from_elsewhere")?.name).toBe("Dana");
    // Without creating, only existing people are linked.
    expect(linkGamePlayers(state, people, NOW, null).state.players.map((player) => player.personId))
      .toEqual(["person_alex", undefined, undefined, undefined, undefined, "person_from_elsewhere"]);
  });
});

describe("Player History grouping", () => {
  it("groups by person id, merged people, aliases, and legacy names", () => {
    const people = directory(
      person("person_mike", "Michael", { aliases: ["Mike"] }),
      person("person_mikey", "Mikey", { mergedIntoId: "person_mike" })
    );
    const games: ArchivedGame[] = [
      game("2026-10-03T00:00:00.000Z", [{ name: "Big Mike", personId: "person_mike", buyInCents: 500 }, { name: "Alex", buyInCents: 100 }]),
      game("2026-10-02T00:00:00.000Z", [{ name: "Mikey", personId: "person_mikey", buyInCents: 300 }, { name: "ALEX ", buyInCents: 100 }]),
      game("2026-10-01T00:00:00.000Z", [{ name: "mike", buyInCents: 200 }, { name: "Stranger", personId: "person_unknown", buyInCents: 50 }]),
      game("2026-09-01T00:00:00.000Z", [{ name: "Gone", isActive: false }])
    ];
    const stats = buildPlayerHistoryStats(games, people);
    expect(stats).toEqual([
      expect.objectContaining({ key: "name:stranger", name: "Stranger", games: 1, results: [expect.objectContaining({ currencyCode: "USD", games: 1, totalNetCents: -50 })] }),
      expect.objectContaining({ key: "name:alex", name: "Alex", games: 2, results: [expect.objectContaining({ currencyCode: "USD", totalNetCents: -200 })], lastPlayedAt: "2026-10-03T00:00:00.000Z" }),
      expect.objectContaining({ key: "person:person_mike", personId: "person_mike", name: "Michael", games: 3, results: [expect.objectContaining({ currencyCode: "USD", totalNetCents: -1000 })] })
    ]);

    // Without a directory, every row falls back to names, as before.
    expect(buildPlayerHistoryStats(games).map((stat) => stat.key).sort()).toEqual(
      ["name:alex", "name:big mike", "name:mike", "name:mikey", "name:stranger"]
    );
  });

  it("suggests people most recently played first, filtered by typed text", () => {
    const people = directory(person("person_mike", "Michael", { aliases: ["Mike"] }), person("person_new", "Nova"));
    const stats = buildPlayerHistoryStats([
      game("2026-10-03T00:00:00.000Z", [{ name: "Alex", buyInCents: 100 }]),
      game("2026-10-01T00:00:00.000Z", [{ name: "Mike", buyInCents: 100 }, { name: "Player 2", buyInCents: 100 }])
    ], people);
    const suggestions = buildPersonSuggestions(stats, people);
    expect(suggestions.map((suggestion) => suggestion.name)).toEqual(["Alex", "Michael", "Nova"]);
    const none = { personIds: new Set<string>(), nameKeys: new Set<string>() };
    expect(filterPersonSuggestions(suggestions, "mi", none).map((suggestion) => suggestion.name)).toEqual(["Michael"]);
    expect(filterPersonSuggestions(suggestions, "", none).map((suggestion) => suggestion.name)).toEqual(["Alex", "Michael", "Nova"]);
    expect(filterPersonSuggestions(suggestions, "alex", none)).toEqual([]);
    expect(
      filterPersonSuggestions(suggestions, "Player 1", { personIds: new Set(["person_mike"]), nameKeys: new Set(["alex"]) })
        .map((suggestion) => suggestion.name)
    ).toEqual(["Nova"]);
  });
});
