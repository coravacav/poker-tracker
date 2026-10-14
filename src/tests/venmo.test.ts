import { describe, expect, it } from "vitest";
import {
  EMPTY_PEOPLE_DIRECTORY,
  linkGamePlayers,
  mergeIntoPerson,
  mergePeopleDirectories,
  parsePeopleDirectory,
  personVenmoHandle,
  indexPeople,
  setPersonVenmoHandle,
  venmoHandleForLink,
  type PeopleDirectory
} from "../domain/people";
import type { GameState, Player, PlayerLedgerSummary, Transaction } from "../domain/pokerTypes";
import {
  buildSettlementPlan,
  buildSettlementSummaryText,
  settlementVenmoPayUrl
} from "../domain/settlement";
import { validatePersistedState } from "../domain/validation";
import {
  buildVenmoPayUrl,
  formatVenmoAmount,
  normalizeVenmoHandle,
  venmoHandleError,
  venmoSettlementNote,
  venmoSupportsCurrency
} from "../domain/venmo";
import { applyHostedAction, normalizeGameState, sanitizeGuestState } from "../session/roomProtocol";
import { buildBackup, parseBackup } from "../state/backup";
import { gameReducer } from "../state/gameReducer";
import { migratePersistedState } from "../state/persistence";
import { createDefaultGameState } from "../state/seedGame";

const NOW = "2026-10-14T12:00:00.000Z";

function summary(playerId: string, netCents: number): PlayerLedgerSummary {
  return {
    playerId,
    bankBuyInsCents: 0,
    bankCashOutsCents: 0,
    sentToPlayersCents: 0,
    receivedFromPlayersCents: 0,
    owedToPlayersCents: 0,
    owedByPlayersCents: 0,
    debtCoveredByOthersCents: 0,
    debtCoveredForOthersCents: 0,
    netCents
  };
}

function directoryWith(people: Array<{ id: string; name: string; venmoHandle?: string; mergedIntoId?: string }>): PeopleDirectory {
  return parsePeopleDirectory({
    schemaVersion: 1,
    people: people.map((person) => ({ aliases: [], createdAt: NOW, updatedAt: NOW, ...person }))
  })!.directory;
}

describe("Venmo usernames", () => {
  it("accepts usernames leniently and stores the bare username", () => {
    expect(normalizeVenmoHandle("alex-smith")).toBe("alex-smith");
    expect(normalizeVenmoHandle("  @Alex_Smith-2 ")).toBe("Alex_Smith-2");
    expect(normalizeVenmoHandle("https://venmo.com/u/alex-smith")).toBe("alex-smith");
    expect(normalizeVenmoHandle("venmo.com/alex-smith?txn=pay")).toBe("alex-smith");
    expect(normalizeVenmoHandle("https://account.venmo.com/u/alex-smith")).toBe("alex-smith");
    expect(normalizeVenmoHandle("a".repeat(30))).toBe("a".repeat(30));
  });

  it("rejects values that are not Venmo usernames", () => {
    for (const value of ["", "   ", "@", "abcd", "a".repeat(31), "alex smith", "alex.smith", "@@alexsmith", "alex/../x", "alex?amount=1", "álexsmith", "https://evil.com/alexsmith", 42, null, undefined]) {
      expect(normalizeVenmoHandle(value)).toBeNull();
    }
  });

  it("explains invalid input but not blank input", () => {
    expect(venmoHandleError("")).toBeNull();
    expect(venmoHandleError("@alexsmith")).toBeNull();
    expect(venmoHandleError("abc")).toMatch(/5–30 letters, numbers, hyphens, or underscores/);
  });
});

describe("Venmo pay links", () => {
  it("formats amounts as plain decimal dollars", () => {
    expect(formatVenmoAmount(1)).toBe("0.01");
    expect(formatVenmoAmount(99)).toBe("0.99");
    expect(formatVenmoAmount(1000)).toBe("10.00");
    expect(formatVenmoAmount(1250)).toBe("12.50");
    expect(formatVenmoAmount(123456789)).toBe("1234567.89");
  });

  it("builds an encoded https pay link", () => {
    expect(buildVenmoPayUrl({ handle: "blair-v", amountCents: 1250, note: "Friday & Co poker settlement" })).toBe(
      "https://venmo.com/blair-v?txn=pay&amount=12.50&note=Friday+%26+Co+poker+settlement"
    );
    const url = new URL(buildVenmoPayUrl({ handle: "blair_v", amountCents: 5, note: "Mañana #1 = 100%?" })!);
    expect(url.origin).toBe("https://venmo.com");
    expect(url.pathname).toBe("/blair_v");
    expect(Object.fromEntries(url.searchParams)).toEqual({ txn: "pay", amount: "0.05", note: "Mañana #1 = 100%?" });
  });

  it("returns no link for unusable usernames or amounts", () => {
    expect(buildVenmoPayUrl({ handle: undefined, amountCents: 100, note: "x" })).toBeNull();
    expect(buildVenmoPayUrl({ handle: "@blair-v", amountCents: 100, note: "x" })).toBeNull();
    expect(buildVenmoPayUrl({ handle: "blair-v", amountCents: 0, note: "x" })).toBeNull();
    expect(buildVenmoPayUrl({ handle: "blair-v", amountCents: -100, note: "x" })).toBeNull();
    expect(buildVenmoPayUrl({ handle: "blair-v", amountCents: 12.5, note: "x" })).toBeNull();
  });

  it("names the game in the note without repeating poker", () => {
    expect(venmoSettlementNote("Friday Game")).toBe("Friday Game poker settlement");
    expect(venmoSettlementNote("  Poker  Night ")).toBe("Poker Night settlement");
    expect(venmoSettlementNote("")).toBe("Poker Night settlement");
  });

  it("offers links for US dollars only", () => {
    expect(venmoSupportsCurrency("USD")).toBe(true);
    expect(venmoSupportsCurrency("EUR")).toBe(false);
    expect(venmoSupportsCurrency("CAD")).toBe(false);
  });
});

describe("Venmo links in settlement", () => {
  const players: Player[] = [
    { id: "alex", name: "Alex", seatIndex: 0, isActive: true },
    { id: "blair", name: "Blair", seatIndex: 1, isActive: true, venmoHandle: "blair-v" },
    { id: "casey", name: "Casey", seatIndex: 2, isActive: true }
  ];
  const nets = [summary("alex", -3000), summary("blair", 1000), summary("casey", 2000)];

  it("links unpaid payments to recipients with a username, for USD games", () => {
    const plan = buildSettlementPlan(nets);
    const toBlair = plan.payments.find((payment) => payment.toPlayerId === "blair")!;
    const toCasey = plan.payments.find((payment) => payment.toPlayerId === "casey")!;
    expect(settlementVenmoPayUrl(toBlair, players, "Friday", "USD")).toBe(
      "https://venmo.com/blair-v?txn=pay&amount=10.00&note=Friday+poker+settlement"
    );
    expect(settlementVenmoPayUrl(toCasey, players, "Friday", "USD")).toBeNull();
    expect(settlementVenmoPayUrl(toBlair, players, "Friday", "EUR")).toBeNull();
    expect(settlementVenmoPayUrl({ ...toBlair, status: "locked", pinId: "pin" }, players, "Friday", "USD")).not.toBeNull();
    expect(settlementVenmoPayUrl({ ...toBlair, status: "paid", pinId: "pin" }, players, "Friday", "USD")).toBeNull();
  });

  it("appends links to unpaid summary lines only", () => {
    const text = buildSettlementSummaryText("Friday", players, nets);
    expect(text).toContain(
      "Alex pays Blair $10.00 - Venmo: https://venmo.com/blair-v?txn=pay&amount=10.00&note=Friday+poker+settlement"
    );
    expect(text).toContain("Alex pays Casey $20.00\n");
    expect(text.split("\n").find((line) => line.startsWith("Alex pays Casey"))).toBe("Alex pays Casey $20.00");

    const paid = buildSettlementSummaryText("Friday", players, nets, [
      { id: "pin", fromPlayerId: "alex", toPlayerId: "blair", amountCents: 1000, status: "paid" }
    ]);
    expect(paid).not.toContain("venmo.com");
    expect(paid).toContain("Alex paid Blair $10.00");

    expect(buildSettlementSummaryText("Friday", players, nets, [], { currencyCode: "EUR" })).not.toContain("venmo.com");
    expect(buildSettlementSummaryText("Friday", players, nets, [], { venmoLinks: false })).not.toContain("venmo.com");
  });
});

describe("Venmo usernames in the people directory", () => {
  it("keeps valid usernames, drops invalid ones, and keeps the person", () => {
    const parsed = parsePeopleDirectory({
      schemaVersion: 1,
      people: [
        { id: "person_a", name: "Alex", aliases: [], venmoHandle: "@alex-pays", createdAt: NOW, updatedAt: NOW },
        { id: "person_b", name: "Blair", aliases: [], venmoHandle: "no way!", createdAt: NOW, updatedAt: NOW }
      ]
    })!;
    expect(parsed.skipped).toEqual([]);
    expect(parsed.directory.people[0].venmoHandle).toBe("alex-pays");
    expect(parsed.directory.people[1]).not.toHaveProperty("venmoHandle");
  });

  it("sets and clears a person's username on the merged root", () => {
    let directory = directoryWith([
      { id: "person_a", name: "Alex" },
      { id: "person_b", name: "Al", mergedIntoId: "person_a" }
    ]);
    directory = setPersonVenmoHandle(directory, "person_b", "@alex-pays", NOW);
    expect(directory.people.find((person) => person.id === "person_a")?.venmoHandle).toBe("alex-pays");
    expect(setPersonVenmoHandle(directory, "person_a", "alex-pays", NOW)).toBe(directory);
    expect(setPersonVenmoHandle(directory, "person_a", "bad handle", NOW)).toBe(directory);
    directory = setPersonVenmoHandle(directory, "person_a", null, NOW);
    expect(directory.people.find((person) => person.id === "person_a")).not.toHaveProperty("venmoHandle");
  });

  it("falls back to a merged person's username", () => {
    const directory = directoryWith([
      { id: "person_a", name: "Alex" },
      { id: "person_b", name: "Al", mergedIntoId: "person_a", venmoHandle: "al-pays" }
    ]);
    expect(personVenmoHandle(indexPeople(directory), "person_a")).toBe("al-pays");
    const merged = mergeIntoPerson(
      directoryWith([
        { id: "person_a", name: "Alex" },
        { id: "person_c", name: "Lex", venmoHandle: "lex-pays" }
      ]),
      [{ personId: "person_a" }, { personId: "person_c" }],
      "Alex",
      NOW,
      "person_new"
    );
    if ("error" in merged) throw new Error(merged.error);
    expect(personVenmoHandle(indexPeople(merged.directory), "person_a")).toBe("lex-pays");
  });

  it("defaults a player's username from the person it links to", () => {
    const directory = directoryWith([
      { id: "person_a", name: "Alex", venmoHandle: "alex-pays" },
      { id: "person_b", name: "Blair" }
    ]);
    // Linking to a person brings their username; linking elsewhere or unlinking clears the old one.
    expect(venmoHandleForLink(directory, undefined, "person_a")).toBe("alex-pays");
    expect(venmoHandleForLink(directory, { venmoHandle: "typed-one" }, "person_a")).toBe("alex-pays");
    expect(venmoHandleForLink(directory, { personId: "person_a", venmoHandle: "alex-pays" }, "person_b")).toBeNull();
    expect(venmoHandleForLink(directory, { personId: "person_a", venmoHandle: "alex-pays" }, null)).toBeNull();
    // Same link: keep what the player has, or fill it in when empty.
    expect(venmoHandleForLink(directory, { personId: "person_a", venmoHandle: "other-one" }, "person_a")).toBeUndefined();
    expect(venmoHandleForLink(directory, { personId: "person_a" }, "person_a")).toBe("alex-pays");
    expect(venmoHandleForLink(directory, { venmoHandle: "typed-one" }, null)).toBeUndefined();
    expect(venmoHandleForLink(directory, { personId: "person_b" }, "person_b")).toBeUndefined();
  });

  it("remembers usernames entered during a game when it is archived", () => {
    const state = createDefaultGameState();
    const buyIn = (playerId: string): Transaction => ({
      id: `t_${playerId}`,
      type: "bank_buy_in",
      createdAt: NOW,
      amountCents: 1000,
      toPlayerId: playerId
    });
    state.players = [
      { id: "p1", name: "Alex", seatIndex: 0, isActive: true, venmoHandle: "alex-new" },
      { id: "p2", name: "Blair", seatIndex: 1, isActive: true, venmoHandle: "blair-pays" },
      { id: "p3", name: "Casey", seatIndex: 2, isActive: true, venmoHandle: "casey-typed" }
    ];
    state.transactions = state.players.map((player) => buyIn(player.id));
    const directory = directoryWith([
      { id: "person_blair", name: "Blair" },
      { id: "person_casey", name: "Casey", venmoHandle: "casey-kept" }
    ]);
    let next = 0;
    const linked = linkGamePlayers(state, directory, NOW, () => `person_new_${(next += 1)}`);
    const handleOf = (name: string) => linked.directory.people.find((person) => person.name === name)?.venmoHandle;
    expect(handleOf("Alex")).toBe("alex-new");
    expect(handleOf("Blair")).toBe("blair-pays");
    // An existing username is not overwritten by what was typed during one game.
    expect(handleOf("Casey")).toBe("casey-kept");
  });

  it("restores usernames from a backup, newer copy winning", () => {
    const local = directoryWith([{ id: "person_a", name: "Alex", venmoHandle: "alex-old" }]);
    const incoming = parsePeopleDirectory({
      schemaVersion: 1,
      people: [
        { id: "person_a", name: "Alex", aliases: [], venmoHandle: "alex-new", createdAt: NOW, updatedAt: "2027-01-01T00:00:00.000Z" },
        { id: "person_b", name: "Blair", aliases: [], venmoHandle: "blair-pays", createdAt: NOW, updatedAt: NOW }
      ]
    })!.directory;
    const merged = mergePeopleDirectories(local, incoming);
    expect(merged.people.map((person) => [person.name, person.venmoHandle])).toEqual([
      ["Alex", "alex-new"],
      ["Blair", "blair-pays"]
    ]);
    expect(mergePeopleDirectories(EMPTY_PEOPLE_DIRECTORY, local).people[0].venmoHandle).toBe("alex-old");
  });
});

function gameWithHandles(): GameState {
  const state = createDefaultGameState();
  state.players = state.players.slice(0, 2);
  state.players[0] = { ...state.players[0], name: "Mike", personId: "person_mike", venmoHandle: "mike-pays" };
  return state;
}

describe("Venmo usernames on players", () => {
  it("sets, normalizes, and clears a player's username", () => {
    const state = gameWithHandles();
    const id = state.players[1].id;
    const set = gameReducer(state, { type: "set_player_venmo_handle", playerId: id, venmoHandle: " @Blair_V " });
    expect(set.players[1].venmoHandle).toBe("Blair_V");
    expect(gameReducer(set, { type: "set_player_venmo_handle", playerId: id, venmoHandle: "Blair_V" })).toBe(set);
    expect(gameReducer(set, { type: "set_player_venmo_handle", playerId: id, venmoHandle: "no good" })).toBe(set);
    expect(gameReducer(set, { type: "set_player_venmo_handle", playerId: "missing", venmoHandle: "Blair_V" })).toBe(set);
    expect(gameReducer(set, { type: "set_player_venmo_handle", playerId: id, venmoHandle: null }).players[1]).not.toHaveProperty(
      "venmoHandle"
    );
  });

  it("changes the username with a rename only when the action carries one", () => {
    const state = gameWithHandles();
    const id = state.players[0].id;
    expect(gameReducer(state, { type: "rename_player", playerId: id, name: "Michael" }).players[0].venmoHandle).toBe("mike-pays");
    expect(
      gameReducer(state, { type: "rename_player", playerId: id, name: "Sam", personId: "person_sam", venmoHandle: "sam-pays" })
        .players[0]
    ).toMatchObject({ name: "Sam", personId: "person_sam", venmoHandle: "sam-pays" });
    expect(
      gameReducer(state, { type: "rename_player", playerId: id, name: "Sam", personId: null, venmoHandle: null }).players[0]
    ).not.toHaveProperty("venmoHandle");
  });

  it("applies parallel usernames in fast entry", () => {
    const state = gameWithHandles();
    const next = gameReducer(state, {
      type: "replace_active_players",
      names: ["Mike", "Blair", "Casey"],
      personIds: [undefined, "person_blair", null],
      venmoHandles: [undefined, "blair-pays", "bad!"]
    });
    const active = next.players.filter((player) => player.isActive).sort((a, b) => a.seatIndex - b.seatIndex);
    expect(active.map((player) => player.venmoHandle)).toEqual(["mike-pays", "blair-pays", undefined]);
  });

  it("keeps saved games at schema 7 and drops unusable usernames on load", () => {
    const state = gameWithHandles();
    state.players[1] = { ...state.players[1], venmoHandle: "spaces are bad" };
    const saved = JSON.parse(JSON.stringify(state)) as unknown;
    expect(validatePersistedState(saved)).toBe(true);
    const loaded = migratePersistedState(saved as GameState);
    expect(loaded.schemaVersion).toBe(7);
    expect(loaded.players[0].venmoHandle).toBe("mike-pays");
    expect(loaded.players[1]).not.toHaveProperty("venmoHandle");
  });

  it("round-trips through the room snapshot and the guest projection", () => {
    const state = gameWithHandles();
    const snapshot = normalizeGameState(state);
    expect(snapshot.players[0]).toMatchObject({ personId: "person_mike", venmoHandle: "mike-pays" });
    const guest = sanitizeGuestState(snapshot);
    expect(guest.players[0]).toEqual({
      id: state.players[0].id,
      name: "Mike",
      seatIndex: state.players[0].seatIndex,
      isActive: true,
      venmoHandle: "mike-pays"
    });
    expect(guest.players[1]).not.toHaveProperty("venmoHandle");

    const result = applyHostedAction(
      snapshot,
      { type: "set_player_venmo_handle", playerId: state.players[1].id, venmoHandle: "blair-pays" },
      NOW,
      () => "transaction_server"
    );
    if ("error" in result) throw new Error(result.error);
    expect(sanitizeGuestState(result.state).players[1].venmoHandle).toBe("blair-pays");
    const unchanged = applyHostedAction(
      result.state,
      { type: "set_player_venmo_handle", playerId: state.players[1].id, venmoHandle: "not valid!" },
      NOW,
      () => "transaction_server"
    );
    expect(unchanged).toHaveProperty("error");
  });

  it("round-trips through a full backup", () => {
    const state = gameWithHandles();
    const people = directoryWith([{ id: "person_mike", name: "Mike", venmoHandle: "mike-pays" }]);
    const backup = JSON.parse(JSON.stringify(buildBackup(state, [{ archivedAt: NOW, state }], new Date(NOW), people)));
    const parsed = parseBackup(backup)!;
    expect(parsed.currentGame?.players[0].venmoHandle).toBe("mike-pays");
    expect(parsed.archivedGames[0].state.players[0].venmoHandle).toBe("mike-pays");
    expect(parsed.people.people[0].venmoHandle).toBe("mike-pays");
  });
});
