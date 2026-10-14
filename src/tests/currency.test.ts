import { describe, expect, it } from "vitest";
import { SUPPORTED_CURRENCY_CODES, type CurrencyCode } from "../domain/money";
import type { GameState, Player, PlayerLedgerSummary } from "../domain/pokerTypes";
import { buildSettlementSummaryText, settlementVenmoPayUrl, buildSettlementPlan } from "../domain/settlement";
import {
  buildPlayerHistoryStats,
  historyMainCurrency,
  type ArchivedGame
} from "../domain/sessionHistory";
import { schemaVersionForCurrency, validatePersistedState } from "../domain/validation";
import { venmoSupportsCurrency } from "../domain/venmo";
import { parseChipFastEntry } from "../domain/chipKeyFastEntry";
import {
  applyHostedAction,
  normalizeGameState,
  roomStateError,
  sanitizeGuestState
} from "../session/roomProtocol";
import { buildBackup, parseBackup } from "../state/backup";
import { archiveGame, loadArchivedGames } from "../state/gameArchive";
import { gameReducer } from "../state/gameReducer";
import {
  CURRENT_SCHEMA_VERSION,
  loadGameState,
  migratePersistedState,
  saveGameState,
  STORAGE_KEY
} from "../state/persistence";
import { createDefaultGameState } from "../state/seedGame";
import { listQuarantined, reasonForInvalid } from "../state/storageQuarantine";

/** The schema a build from before per-game currencies could read. */
const PRE_CURRENCY_SCHEMA_VERSION = 7;

function gameIn(currencyCode: CurrencyCode): GameState {
  return gameReducer(createDefaultGameState(), { type: "set_currency", currencyCode });
}

describe("currency in saved games", () => {
  it("saves US dollar games as schema 7 and other currencies as schema 8", () => {
    expect(createDefaultGameState().schemaVersion).toBe(7);
    expect(createDefaultGameState("EUR")).toMatchObject({ schemaVersion: 8, settings: { currencyCode: "EUR" } });
    for (const code of SUPPORTED_CURRENCY_CODES) {
      expect(schemaVersionForCurrency(code)).toBe(code === "USD" ? 7 : 8);
      expect(validatePersistedState(createDefaultGameState(code)), code).toBe(true);
    }
    expect(CURRENT_SCHEMA_VERSION).toBe(8);
  });

  it("accepts non-USD currencies only from schema 8, and only supported codes", () => {
    const euro = createDefaultGameState("EUR");
    expect(validatePersistedState(euro)).toBe(true);
    // Schema 7 and older saves are always US dollars.
    expect(validatePersistedState({ ...euro, schemaVersion: 7 })).toBe(false);
    expect(validatePersistedState({ ...euro, schemaVersion: 6 })).toBe(false);
    for (const currencyCode of ["JPY", "eur", "", "XXX", 7, null, undefined]) {
      expect(validatePersistedState({ ...euro, settings: { ...euro.settings, currencyCode } }), String(currencyCode)).toBe(false);
    }
    expect(validatePersistedState({ ...euro, schemaVersion: 9 })).toBe(false);
  });

  it("reads a schema 8 US dollar save back as schema 7", () => {
    const usd = { ...createDefaultGameState(), schemaVersion: 8 as const };
    expect(validatePersistedState(usd)).toBe(true);
    expect(migratePersistedState(usd).schemaVersion).toBe(7);
  });

  it("loads a saved euro game with its currency", () => {
    const euro = createDefaultGameState("SEK");
    saveGameState(euro);
    expect(loadGameState()).toMatchObject({ schemaVersion: 8, settings: { currencyCode: "SEK" } });
    expect(listQuarantined()).toEqual([]);
  });

  it("makes builds from before currencies report a newer version instead of unreadable data", () => {
    const raw = JSON.parse(JSON.stringify(createDefaultGameState("EUR"))) as unknown;
    expect(reasonForInvalid(raw, PRE_CURRENCY_SCHEMA_VERSION)).toBe("newer_version");
    // US dollar games are unchanged for those builds.
    const usd = JSON.parse(JSON.stringify(createDefaultGameState())) as { schemaVersion: number };
    expect(usd.schemaVersion).toBeLessThanOrEqual(PRE_CURRENCY_SCHEMA_VERSION);
  });

  it("quarantines a save from a later schema as newer", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...createDefaultGameState("EUR"), schemaVersion: 9 }));
    loadGameState();
    expect(listQuarantined()[0]).toMatchObject({ reason: "newer_version" });
  });

  it("keeps currencies through backups and Player History", async () => {
    const played = (state: GameState) => {
      state.transactions.push({
        id: `buy_${state.settings.currencyCode}`,
        type: "bank_buy_in",
        toPlayerId: state.players[0].id,
        amountCents: 2000,
        createdAt: "2026-10-01T00:00:00.000Z"
      });
      return state;
    };
    const euro = played(createDefaultGameState("EUR"));
    const pounds = played(createDefaultGameState("GBP"));
    expect(await archiveGame(euro)).toBe(true);
    const archived = await loadArchivedGames();
    expect(archived[0].state.settings.currencyCode).toBe("EUR");

    const restored = parseBackup(JSON.parse(JSON.stringify(buildBackup(pounds, archived))));
    expect(restored?.currentGame?.settings.currencyCode).toBe("GBP");
    expect(restored?.archivedGames[0].state.settings.currencyCode).toBe("EUR");
  });
});

describe("set_currency", () => {
  it("relabels the game without touching amounts and moves between schemas", () => {
    const start = createDefaultGameState();
    start.transactions.push({
      id: "buy",
      type: "bank_buy_in",
      toPlayerId: start.players[0].id,
      amountCents: 2050,
      createdAt: "2026-10-01T00:00:00.000Z"
    });
    const euro = gameReducer(start, { type: "set_currency", currencyCode: "EUR" });
    expect(euro).toMatchObject({ schemaVersion: 8, settings: { currencyCode: "EUR", defaultBuyInCents: 2000 } });
    expect(euro.transactions).toEqual(start.transactions);

    const back = gameReducer(euro, { type: "set_currency", currencyCode: "USD" });
    expect(back).toMatchObject({ schemaVersion: 7, settings: { currencyCode: "USD" } });
  });

  it("ignores unsupported codes and no-op changes", () => {
    const euro = gameIn("EUR");
    expect(gameReducer(euro, { type: "set_currency", currencyCode: "JPY" as CurrencyCode })).toBe(euro);
    expect(gameReducer(euro, { type: "set_currency", currencyCode: "EUR" })).toBe(euro);
  });

  it("starts the next game in the same currency", () => {
    const next = gameReducer(gameIn("CHF"), { type: "reset_game" });
    expect(next).toMatchObject({ schemaVersion: 8, settings: { currencyCode: "CHF" }, transactions: [] });
  });
});

describe("currency in shared rooms", () => {
  it("round-trips the currency through the room snapshot and guest projection", () => {
    const euro = gameIn("EUR");
    expect(roomStateError(euro)).toBeNull();
    expect(normalizeGameState(euro)).toMatchObject({ schemaVersion: 8, settings: { currencyCode: "EUR" } });
    expect(sanitizeGuestState(euro).settings.currencyCode).toBe("EUR");
    expect(normalizeGameState(createDefaultGameState()).schemaVersion).toBe(7);
  });

  it("accepts set_currency as a hosted action", () => {
    const result = applyHostedAction(
      createDefaultGameState(),
      { type: "set_currency", currencyCode: "NOK" },
      "2026-10-14T12:00:00.000Z",
      () => "transaction_server"
    );
    expect("state" in result && result.state).toMatchObject({ schemaVersion: 8, settings: { currencyCode: "NOK" } });

    const rejected = applyHostedAction(
      createDefaultGameState(),
      { type: "set_currency", currencyCode: "JPY" },
      "2026-10-14T12:00:00.000Z",
      () => "transaction_server"
    );
    expect(rejected).toEqual({ error: "The action did not apply to the current room state." });
  });

  it("rejects a room snapshot whose currency does not match its schema", () => {
    const mislabeled = { ...gameIn("EUR"), schemaVersion: 7 };
    expect(roomStateError(mislabeled)).toMatch(/schema/);
  });
});

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

describe("settlement text and Venmo per currency", () => {
  const players: Player[] = [
    { id: "alex", name: "Alex", seatIndex: 0, isActive: true },
    { id: "blair", name: "Blair", seatIndex: 1, isActive: true, venmoHandle: "blair-v" }
  ];
  const nets = [summary("alex", -123450), summary("blair", 123450)];

  it("formats the copied summary in the game's currency and locale", () => {
    const text = buildSettlementSummaryText("Friday", players, nets, [], { currencyCode: "EUR", locale: "de-DE" });
    expect(text).toContain("Blair: +1.234,50 €");
    expect(text).toContain("Alex: -1.234,50 €");
    expect(text).toContain("Alex pays Blair 1.234,50 €");
    expect(text).not.toContain("$");
    expect(text).not.toContain("venmo.com");

    const pounds = buildSettlementSummaryText("Friday", players, nets, [], { currencyCode: "GBP", locale: "en-GB" });
    expect(pounds).toContain("Alex pays Blair £1,234.50");
  });

  it("offers Venmo links for US dollar games only", () => {
    const [payment] = buildSettlementPlan(nets).payments;
    expect(settlementVenmoPayUrl(payment, players, "Friday", "USD")).toContain("venmo.com/blair-v");
    for (const code of SUPPORTED_CURRENCY_CODES.filter((candidate) => candidate !== "USD")) {
      expect(venmoSupportsCurrency(code), code).toBe(false);
      expect(settlementVenmoPayUrl(payment, players, "Friday", code), code).toBeNull();
      expect(buildSettlementSummaryText("Friday", players, nets, [], { currencyCode: code }), code).not.toContain("venmo.com");
    }
    expect(buildSettlementSummaryText("Friday", players, nets, [], { currencyCode: "USD", locale: "en-US" }))
      .toContain("Alex pays Blair $1,234.50 - Venmo: https://venmo.com/blair-v");
  });
});

describe("Player History across currencies", () => {
  let gameCount = 0;
  function archived(
    archivedAt: string,
    currencyCode: CurrencyCode,
    results: Array<{ name: string; netCents: number }>
  ): ArchivedGame {
    const state = createDefaultGameState(currencyCode);
    state.players = results.map((result, index) => ({
      id: `player_${gameCount}_${index}`,
      name: result.name,
      seatIndex: index,
      isActive: true
    }));
    gameCount += 1;
    // Each player either buys in (a loss) or is owed by the bank via a cash-out (a win).
    state.transactions = results.map((result, index) =>
      result.netCents < 0
        ? {
            id: `buy_${gameCount}_${index}`,
            type: "bank_buy_in" as const,
            toPlayerId: state.players[index].id,
            amountCents: -result.netCents,
            createdAt: archivedAt
          }
        : {
            id: `cash_${gameCount}_${index}`,
            type: "bank_cash_out" as const,
            cashOutKind: "final" as const,
            fromPlayerId: state.players[index].id,
            amountCents: result.netCents,
            createdAt: archivedAt
          }
    );
    return { archivedAt, state };
  }

  const games = [
    archived("2026-10-01T00:00:00.000Z", "USD", [{ name: "Alex", netCents: -2000 }, { name: "Casey", netCents: 2000 }]),
    archived("2026-10-02T00:00:00.000Z", "EUR", [{ name: "Alex", netCents: 1500 }, { name: "Blair", netCents: -1500 }]),
    archived("2026-10-03T00:00:00.000Z", "EUR", [{ name: "Alex", netCents: -500 }, { name: "Blair", netCents: 500 }])
  ];

  it("picks the currency most games were played in", () => {
    expect(historyMainCurrency([])).toBe("USD");
    expect(historyMainCurrency(games)).toBe("EUR");
    // Ties go to the most recently archived game's currency.
    expect(historyMainCurrency(games.slice(0, 2))).toBe("EUR");
    expect(historyMainCurrency([games[0], { ...games[1], archivedAt: "2026-09-01T00:00:00.000Z" }])).toBe("USD");
  });

  it("never sums results across currencies", () => {
    const stats = buildPlayerHistoryStats(games);
    const alex = stats.find((stat) => stat.name === "Alex")!;
    expect(alex.games).toBe(3);
    expect(alex.results).toEqual([
      { currencyCode: "EUR", games: 2, totalNetCents: 1000, averageNetCents: 500, biggestWinCents: 1500, biggestLossCents: -500 },
      { currencyCode: "USD", games: 1, totalNetCents: -2000, averageNetCents: -2000, biggestWinCents: -2000, biggestLossCents: -2000 }
    ]);
    // Ordered by main-currency (EUR) totals; players with no EUR games follow.
    expect(stats.map((stat) => stat.name)).toEqual(["Alex", "Blair", "Casey"]);
    expect(stats.find((stat) => stat.name === "Casey")!.results).toEqual([
      expect.objectContaining({ currencyCode: "USD", totalNetCents: 2000 })
    ]);
  });
});

describe("chip key fast entry with other currencies", () => {
  it("accepts comma decimals and other currency symbols", () => {
    expect(parseChipFastEntry("Red, 0,25\nBlack €100\nGreen = 5 €\nBlue £1")).toEqual({
      ok: true,
      items: [
        { label: "Red", valueCents: 25 },
        { label: "Black", valueCents: 10000 },
        { label: "Green", valueCents: 500 },
        { label: "Blue", valueCents: 100 }
      ]
    });
  });
});
