import { describe, expect, it } from "vitest";
import type { GameState, SettlementPin } from "../domain/pokerTypes";
import { validatePersistedState } from "../domain/validation";
import {
  applyHostedAction,
  normalizeGameState,
  sanitizeGuestState
} from "../session/roomProtocol";
import { gameReducer } from "../state/gameReducer";
import { migratePersistedState } from "../state/persistence";
import { createDefaultGameState } from "../state/seedGame";

function pinFor(state: GameState, overrides: Partial<SettlementPin> = {}): SettlementPin {
  return {
    id: "settlement_pin_1",
    fromPlayerId: state.players[0].id,
    toPlayerId: state.players[1].id,
    amountCents: 2000,
    status: "paid",
    ...overrides
  };
}

describe("settlement pin actions", () => {
  it("pins, changes status, unpins, and clears", () => {
    const state = createDefaultGameState();
    const locked = gameReducer(state, {
      type: "pin_settlement_payment",
      pin: pinFor(state, { status: "locked" })
    });
    expect(locked.settlementPins).toEqual([pinFor(state, { status: "locked" })]);

    const paid = gameReducer(locked, {
      type: "set_settlement_pin_status",
      pinId: "settlement_pin_1",
      status: "paid"
    });
    expect(paid.settlementPins?.[0].status).toBe("paid");

    const unpinned = gameReducer(paid, {
      type: "unpin_settlement_payment",
      pinId: "settlement_pin_1"
    });
    expect(unpinned).not.toHaveProperty("settlementPins");

    const twoPins = gameReducer(
      gameReducer(state, { type: "pin_settlement_payment", pin: pinFor(state) }),
      { type: "pin_settlement_payment", pin: pinFor(state, { id: "settlement_pin_2" }) }
    );
    expect(twoPins.settlementPins).toHaveLength(2);
    expect(gameReducer(twoPins, { type: "clear_settlement_pins" })).not.toHaveProperty(
      "settlementPins"
    );
  });

  it("ignores invalid, duplicate, and no-op pin changes", () => {
    const state = createDefaultGameState();
    const invalidPins = [
      pinFor(state, { toPlayerId: state.players[0].id }),
      pinFor(state, { toPlayerId: "missing-player" }),
      pinFor(state, { amountCents: 0 }),
      pinFor(state, { amountCents: 12.5 }),
      pinFor(state, { status: "disputed" as never }),
      pinFor(state, { id: "" })
    ];
    for (const pin of invalidPins) {
      expect(gameReducer(state, { type: "pin_settlement_payment", pin })).toBe(state);
    }

    const pinned = gameReducer(state, { type: "pin_settlement_payment", pin: pinFor(state) });
    expect(gameReducer(pinned, { type: "pin_settlement_payment", pin: pinFor(state) })).toBe(pinned);
    expect(
      gameReducer(pinned, { type: "set_settlement_pin_status", pinId: "settlement_pin_1", status: "paid" })
    ).toBe(pinned);
    expect(gameReducer(pinned, { type: "unpin_settlement_payment", pinId: "other" })).toBe(pinned);
    expect(gameReducer(state, { type: "clear_settlement_pins" })).toBe(state);
  });

  it("keeps only the pin fields it knows", () => {
    const state = createDefaultGameState();
    const next = gameReducer(state, {
      type: "pin_settlement_payment",
      pin: { ...pinFor(state), note: "extra" } as SettlementPin
    });
    expect(next.settlementPins).toEqual([pinFor(state)]);
  });
});

describe("settlement pins in shared rooms", () => {
  it("accepts pin actions and shares the pins with guests", () => {
    const state = createDefaultGameState();
    const result = applyHostedAction(
      normalizeGameState(state),
      { type: "pin_settlement_payment", pin: pinFor(state) },
      "2026-01-01T00:00:00.000Z",
      () => "transaction_server"
    );
    if ("error" in result) throw new Error(result.error);
    expect(result.state.settlementPins).toEqual([pinFor(state)]);
    expect(sanitizeGuestState(result.state).settlementPins).toEqual([pinFor(state)]);

    const cleared = applyHostedAction(
      result.state,
      { type: "clear_settlement_pins" },
      "2026-01-01T00:00:00.000Z",
      () => "transaction_server"
    );
    if ("error" in cleared) throw new Error(cleared.error);
    expect(cleared.state).not.toHaveProperty("settlementPins");
  });

  it("rejects pin actions that change nothing", () => {
    const state = createDefaultGameState();
    expect(
      applyHostedAction(
        normalizeGameState(state),
        { type: "unpin_settlement_payment", pinId: "missing" },
        "2026-01-01T00:00:00.000Z",
        () => "transaction_server"
      )
    ).toEqual({ error: "The action did not apply to the current room state." });
  });

  it("keeps pin-free room snapshots in their previous shape", () => {
    const state = createDefaultGameState();
    expect(normalizeGameState(state)).not.toHaveProperty("settlementPins");
    expect(
      normalizeGameState({ ...state, settlementPins: [] })
    ).not.toHaveProperty("settlementPins");
  });

  it("drops unusable pins from room snapshots", () => {
    const state = createDefaultGameState();
    const normalized = normalizeGameState({
      ...state,
      settlementPins: [
        pinFor(state),
        pinFor(state, { id: "ghost", toPlayerId: "missing-player" }),
        { junk: true } as never
      ]
    });
    expect(normalized.settlementPins).toEqual([pinFor(state)]);
  });
});

describe("settlement pins in saved games", () => {
  it("round-trips pins and drops ones this build cannot use", () => {
    const state = createDefaultGameState();
    const saved = JSON.parse(
      JSON.stringify({
        ...state,
        settlementPins: [pinFor(state), pinFor(state, { id: "future", status: "disputed" as never })]
      })
    );

    // Unknown pin values never make the whole save invalid.
    expect(validatePersistedState(saved)).toBe(true);
    expect(migratePersistedState(saved).settlementPins).toEqual([pinFor(state)]);

    const onlyBad = { ...saved, settlementPins: "nonsense" };
    expect(validatePersistedState(onlyBad)).toBe(true);
    expect(migratePersistedState(onlyBad)).not.toHaveProperty("settlementPins");
  });
});
