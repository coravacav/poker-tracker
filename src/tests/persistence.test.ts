import { describe, expect, it } from "vitest";
import { validatePersistedState } from "../domain/validation";
import { migratePersistedState } from "../state/persistence";
import { createDefaultGameState } from "../state/seedGame";

describe("chip count persistence", () => {
  it("migrates schema v2 games to v3 with an empty key and drafts", () => {
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
    expect(migrated.schemaVersion).toBe(3);
    expect(migrated.settings.chipDenominations).toEqual([]);
    expect(migrated.cashOutDrafts).toEqual([]);
  });

  it("validates a v3 round trip containing drafts and breakdowns", () => {
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
});
