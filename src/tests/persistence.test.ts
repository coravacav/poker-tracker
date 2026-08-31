import { describe, expect, it } from "vitest";
import { validatePersistedState } from "../domain/validation";
import { loadGameState, migratePersistedState, STORAGE_KEY } from "../state/persistence";
import { createDefaultGameState } from "../state/seedGame";

describe("chip count persistence", () => {
  it("loads an existing v5 local game and assigns its stable local identity", () => {
    const current = createDefaultGameState();
    const { localGameId: _localGameId, ...withoutId } = current;
    const legacy = { ...withoutId, schemaVersion: 5 as const };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));

    const migrated = loadGameState();
    expect(migrated.schemaVersion).toBe(7);
    expect(migrated.localGameId).toMatch(/^game_/);
    expect(migrated.players).toEqual(legacy.players);
  });

  it("migrates schema v2 games to v7 with an empty key, drafts, and stable local id", () => {
    const current = createDefaultGameState();
    const { chipDenominations: _chipDenominations, ...legacySettings } = current.settings;
    const legacy = {
      schemaVersion: 2 as const,
      settings: legacySettings,
      players: current.players,
      transactions: current.transactions
    };

    expect(validatePersistedState(legacy)).toBe(true);
    const migrated = migratePersistedState(legacy);
    expect(migrated.schemaVersion).toBe(7);
    expect(migrated.localGameId).toMatch(/^game_/);
    expect(migrated.settings.chipDenominations).toEqual([]);
    expect(migrated.cashOutDrafts).toEqual([]);
  });

  it("validates a v5 round trip containing drafts and breakdowns", () => {
    const state = createDefaultGameState();
    const player = state.players[0];
    state.settings.chipDenominations = [
      { id: "blue", label: "Blue", colorHex: "#0000ff", valueCents: 500 }
    ];
    state.cashOutDrafts = [
      {
        playerId: player.id,
        lines: [
          { denominationId: "blue", label: "Blue", colorHex: "#0000ff", valueCents: 500, count: 2 }
        ]
      }
    ];
    state.transactions = [
      {
        id: "cashout",
        type: "bank_cash_out",
        cashOutKind: "final",
        createdAt: "2026-01-01",
        amountCents: 1000,
        fromPlayerId: player.id,
        chipCountBreakdown: [
          { denominationId: "blue", label: "Blue", colorHex: "#0000ff", valueCents: 500, count: 2 }
        ]
      }
    ];

    expect(validatePersistedState(JSON.parse(JSON.stringify(state)))).toBe(true);
  });

  it("migrates schema v3 player transfers to explicit transaction types", () => {
    const current = createDefaultGameState();
    const legacy = {
      ...current,
      schemaVersion: 3 as const,
      transactions: [
        {
          id: "food",
          type: "player_transfer" as const,
          createdAt: "2026-01-01",
          amountCents: 500,
          fromPlayerId: current.players[0].id,
          toPlayerId: current.players[1].id,
          category: "food" as const
        }
      ]
    };

    expect(validatePersistedState(legacy)).toBe(true);
    const migrated = migratePersistedState(legacy);
    expect(migrated.schemaVersion).toBe(7);
    expect(migrated.transactions).toEqual([
      expect.objectContaining({
        id: "food",
        type: "player_owes",
        fromPlayerId: current.players[1].id,
        toPlayerId: current.players[0].id,
        category: "food"
      })
    ]);
  });

  it("migrates v6 player transfers while preserving the stable local id", () => {
    const current = createDefaultGameState();
    const legacy = {
      ...current,
      schemaVersion: 6 as const,
      transactions: [
        {
          id: "chips",
          type: "player_transfer" as const,
          createdAt: "2026-01-01",
          amountCents: 500,
          fromPlayerId: current.players[0].id,
          toPlayerId: current.players[1].id,
          category: "poker" as const
        }
      ]
    };

    expect(validatePersistedState(legacy)).toBe(true);
    const migrated = migratePersistedState(legacy);

    expect(migrated.schemaVersion).toBe(7);
    expect(migrated.localGameId).toBe(current.localGameId);
    expect(migrated.transactions[0]).toEqual(
      expect.objectContaining({ id: "chips", type: "player_gave" })
    );
  });

  it("infers partial and final kinds for legacy cash-outs and correction history", () => {
    const current = createDefaultGameState();
    const player = current.players[0];
    const legacy = {
      ...current,
      schemaVersion: 4 as const,
      transactions: [
        {
          id: "early",
          type: "bank_cash_out" as const,
          createdAt: "2026-01-01T01:00:00Z",
          amountCents: 500,
          fromPlayerId: player.id
        },
        {
          id: "original-final",
          type: "bank_cash_out" as const,
          createdAt: "2026-01-01T02:00:00Z",
          amountCents: 1500,
          fromPlayerId: player.id,
          voidedAt: "2026-01-01T03:00:00Z",
          voidReason: "Corrected chip count"
        },
        {
          id: "corrected-final",
          type: "bank_cash_out" as const,
          createdAt: "2026-01-01T02:00:00Z",
          amountCents: 1600,
          fromPlayerId: player.id,
          correctsTransactionId: "original-final"
        }
      ]
    };

    expect(validatePersistedState(legacy)).toBe(true);
    const migrated = migratePersistedState(legacy);

    expect(migrated.transactions.map((transaction) => transaction.cashOutKind)).toEqual([
      "partial",
      "final",
      "final"
    ]);
  });

  it("requires valid cash-out kinds in schema v5", () => {
    const state = createDefaultGameState();
    state.transactions = [
      {
        id: "missing-kind",
        type: "bank_cash_out",
        createdAt: "2026-01-01",
        amountCents: 1000,
        fromPlayerId: state.players[0].id
      }
    ];
    expect(validatePersistedState(JSON.parse(JSON.stringify(state)))).toBe(false);

    state.transactions[0].cashOutKind = "partial";
    expect(validatePersistedState(JSON.parse(JSON.stringify(state)))).toBe(true);

    state.transactions[0].amountCents = 0;
    expect(validatePersistedState(JSON.parse(JSON.stringify(state)))).toBe(false);
  });

  it("validates v5 covered buy-ins and debt coverage", () => {
    const state = createDefaultGameState();
    const [alex, blair] = state.players;
    state.transactions = [
      {
        id: "covered-buy-in",
        type: "bank_buy_in",
        createdAt: "2026-01-01",
        amountCents: 2000,
        toPlayerId: blair.id,
        coveredByPlayerId: alex.id
      },
      {
        id: "coverage",
        type: "debt_coverage",
        createdAt: "2026-01-02",
        amountCents: 2000,
        coveredPlayerId: alex.id,
        coveredByPlayerId: blair.id
      }
    ];

    expect(validatePersistedState(JSON.parse(JSON.stringify(state)))).toBe(true);

    state.transactions[1].coveredByPlayerId = "missing";
    expect(validatePersistedState(JSON.parse(JSON.stringify(state)))).toBe(false);
  });
});
