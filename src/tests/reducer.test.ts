import { describe, expect, it } from "vitest";
import { calculateBankSummary } from "../domain/ledger";
import type { GameState } from "../domain/pokerTypes";
import { getLatestTransactionAction } from "../domain/recentTransactionAction";
import { gameReducer } from "../state/gameReducer";
import { createDefaultGameState } from "../state/seedGame";

function undoLatest(state: GameState, requestedAt: string): GameState {
  const action = getLatestTransactionAction(state.transactions);
  if (!action) {
    throw new Error("Expected a transaction action to undo");
  }

  return gameReducer(state, {
    type: "undo_recent_transaction",
    action,
    requestedAt
  });
}

describe("gameReducer", () => {
  it("defaults new games to rectangle dynamic table settings", () => {
    const state = createDefaultGameState();

    expect(state.schemaVersion).toBe(5);
    expect(state.settings.chipDenominations).toEqual([]);
    expect(state.cashOutDrafts).toEqual([]);
    expect(state.settings.tableShape).toBe("rectangle");
    expect(state.settings.tableSeatPlacements).toEqual([
      { seatIndex: 0, rail: "top", order: 0 },
      { seatIndex: 1, rail: "top", order: 1 },
      { seatIndex: 2, rail: "top", order: 2 },
      { seatIndex: 3, rail: "bottom", order: 0 },
      { seatIndex: 4, rail: "bottom", order: 1 },
      { seatIndex: 5, rail: "bottom", order: 2 }
    ]);
  });

  it("adds, renames, and reorders players", () => {
    let state = createDefaultGameState();
    state = gameReducer(state, { type: "add_player", name: "Sam" });
    const addedPlayer = state.players[state.players.length - 1];

    expect(addedPlayer?.name).toBe("Sam");

    state = gameReducer(state, {
      type: "rename_player",
      playerId: addedPlayer!.id,
      name: "Taylor"
    });

    expect(state.players.find((player) => player.id === addedPlayer!.id)?.name).toBe("Taylor");

    const orderedPlayerIds = state.players.map((player) => player.id).reverse();
    state = gameReducer(state, { type: "reorder_players", orderedPlayerIds });

    expect(
      [...state.players].sort((a, b) => a.seatIndex - b.seatIndex).map((player) => player.id)
    ).toEqual(orderedPlayerIds);
  });

  it("replaces the active roster in line order while preserving reusable players", () => {
    const initialState = createDefaultGameState();
    const initialIds = initialState.players.map((player) => player.id);

    const state = gameReducer(initialState, {
      type: "replace_active_players",
      names: ["  Alex  ", "", "alex", "  Blair"]
    });
    const activePlayers = state.players
      .filter((player) => player.isActive)
      .sort((a, b) => a.seatIndex - b.seatIndex);

    expect(activePlayers.map((player) => player.id)).toEqual(initialIds.slice(0, 3));
    expect(activePlayers.map((player) => player.name)).toEqual([
      "Alex",
      "alex",
      "Blair"
    ]);
    expect(activePlayers.map((player) => player.seatIndex)).toEqual([0, 1, 2]);
    expect(state.players.slice(3).every((player) => !player.isActive)).toBe(true);
    expect(state.settings.tableSeatPlacements).toHaveLength(3);
  });

  it("creates players when the replacement roster is longer", () => {
    let state = createDefaultGameState();
    state = gameReducer(state, { type: "set_player_count", count: 1 });
    const reusedPlayerId = state.players.find((player) => player.isActive)!.id;

    state = gameReducer(state, {
      type: "replace_active_players",
      names: ["Alex", "Blair", "Casey"]
    });
    const activePlayers = state.players
      .filter((player) => player.isActive)
      .sort((a, b) => a.seatIndex - b.seatIndex);

    expect(activePlayers.map((player) => player.name)).toEqual([
      "Alex",
      "Blair",
      "Casey"
    ]);
    expect(activePlayers.map((player) => player.seatIndex)).toEqual([0, 1, 2]);
    expect(activePlayers[0].id).toBe(reusedPlayerId);
    expect(new Set(activePlayers.map((player) => player.id)).size).toBe(3);
  });

  it("rejects an empty replacement roster", () => {
    const state = createDefaultGameState();

    expect(
      gameReducer(state, {
        type: "replace_active_players",
        names: ["", "   "]
      })
    ).toBe(state);
  });

  it("refuses roster replacement after a transaction or cash-out draft exists", () => {
    const transactionState = createDefaultGameState();
    transactionState.transactions = [
      {
        id: "voided-buy-in",
        type: "bank_buy_in",
        createdAt: "2026-05-10T00:00:00.000Z",
        amountCents: 2000,
        toPlayerId: transactionState.players[0].id,
        voidedAt: "2026-05-10T00:01:00.000Z",
        voidReason: "Mistake"
      }
    ];

    expect(
      gameReducer(transactionState, {
        type: "replace_active_players",
        names: ["Alex"]
      })
    ).toBe(transactionState);

    const draftState = createDefaultGameState();
    draftState.cashOutDrafts = [
      { playerId: draftState.players[0].id, lines: [] }
    ];

    expect(
      gameReducer(draftState, {
        type: "replace_active_players",
        names: ["Alex"]
      })
    ).toBe(draftState);
  });

  it("adds and voids transactions", () => {
    let state = createDefaultGameState();
    const player = state.players[0];

    state = gameReducer(state, {
      type: "add_transaction",
      transaction: {
        id: "t1",
        type: "bank_buy_in",
        createdAt: "2026-05-10T00:00:00.000Z",
        amountCents: 2000,
        toPlayerId: player.id
      }
    });

    expect(state.transactions).toHaveLength(1);

    state = gameReducer(state, {
      type: "void_transaction",
      transactionId: "t1",
      reason: "mistake"
    });

    expect(state.transactions[0].voidedAt).toBeTruthy();
    expect(state.transactions[0].voidReason).toBe("mistake");
  });

  it("fully removes a recent transaction and recalculates the bank ledger", () => {
    let state = createDefaultGameState();
    state = gameReducer(state, {
      type: "add_transaction",
      transaction: {
        id: "buy-in",
        type: "bank_buy_in",
        createdAt: "2026-05-10T00:00:10.000Z",
        amountCents: 2000,
        toPlayerId: state.players[0].id
      }
    });

    expect(calculateBankSummary(state.transactions).balanceCents).toBe(2000);
    state = undoLatest(state, "2026-05-10T00:00:20.000Z");

    expect(state.transactions).toEqual([]);
    expect(calculateBankSummary(state.transactions).balanceCents).toBe(0);
  });

  it("rejects a non-latest or expired undo request", () => {
    const state = createDefaultGameState();
    state.transactions = [
      {
        id: "first",
        type: "bank_buy_in",
        createdAt: "2026-05-10T00:00:05.000Z",
        amountCents: 2000,
        toPlayerId: state.players[0].id
      },
      {
        id: "second",
        type: "bank_buy_in",
        createdAt: "2026-05-10T00:00:10.000Z",
        amountCents: 2000,
        toPlayerId: state.players[1].id
      }
    ];

    expect(
      gameReducer(state, {
        type: "undo_recent_transaction",
        action: {
          kind: "create",
          transactionId: "first",
          occurredAt: "2026-05-10T00:00:05.000Z"
        },
        requestedAt: "2026-05-10T00:00:20.000Z"
      })
    ).toBe(state);
    expect(undoLatest(state, "2026-05-10T00:00:40.000Z")).toBe(state);
  });

  it("undoes a recent void on an older transaction", () => {
    let state = createDefaultGameState();
    state.transactions = [
      {
        id: "older",
        type: "bank_buy_in",
        createdAt: "2026-05-10T00:00:00.000Z",
        amountCents: 2000,
        toPlayerId: state.players[0].id,
        voidedAt: "2026-05-10T00:00:25.000Z",
        voidReason: "Correction"
      },
      {
        id: "newer",
        type: "bank_buy_in",
        createdAt: "2026-05-10T00:00:20.000Z",
        amountCents: 2000,
        toPlayerId: state.players[1].id
      }
    ];

    state = undoLatest(state, "2026-05-10T00:00:30.000Z");

    expect(state.transactions).toHaveLength(2);
    expect(state.transactions[0].voidedAt).toBeUndefined();
    expect(state.transactions[0].voidReason).toBeUndefined();
  });

  it("undoes a flip atomically by removing its result and restoring its original", () => {
    let state = createDefaultGameState();
    const player = state.players[0];
    state.transactions = [
      {
        id: "original",
        type: "bank_buy_in",
        createdAt: "2026-05-10T00:00:00.000Z",
        amountCents: 2000,
        toPlayerId: player.id,
        voidedAt: "2026-05-10T00:00:20.100Z",
        voidReason: "Flipped transaction"
      },
      {
        id: "flipped",
        type: "bank_cash_out",
        createdAt: "2026-05-10T00:00:20.000Z",
        amountCents: 2000,
        fromPlayerId: player.id,
        flippedFromTransactionId: "original"
      }
    ];

    state = undoLatest(state, "2026-05-10T00:00:25.000Z");

    expect(state.transactions).toEqual([
      expect.objectContaining({ id: "original", type: "bank_buy_in" })
    ]);
    expect(state.transactions[0].voidedAt).toBeUndefined();
  });

  it("undoes a cash-out correction and restores its editable correction draft", () => {
    let state = createDefaultGameState();
    const player = state.players[0];
    state.transactions = [
      {
        id: "original",
        type: "bank_cash_out",
        createdAt: "2026-05-10T00:00:00.000Z",
        amountCents: 1000,
        fromPlayerId: player.id,
        voidedAt: "2026-05-10T00:00:20.100Z",
        voidReason: "Corrected chip count"
      },
      {
        id: "corrected",
        type: "bank_cash_out",
        createdAt: "2026-05-10T00:00:20.000Z",
        amountCents: 1500,
        fromPlayerId: player.id,
        correctsTransactionId: "original",
        chipCountBreakdown: [
          {
            denominationId: "blue",
            label: "Blue",
            colorHex: "#0000ff",
            valueCents: 500,
            count: 3
          }
        ]
      }
    ];

    state = undoLatest(state, "2026-05-10T00:00:25.000Z");

    expect(state.transactions).toEqual([expect.objectContaining({ id: "original" })]);
    expect(state.transactions[0].voidedAt).toBeUndefined();
    expect(state.cashOutDrafts).toEqual([
      {
        playerId: player.id,
        correctingTransactionId: "original",
        lines: [expect.objectContaining({ denominationId: "blue", count: 3 })]
      }
    ]);
  });

  it("restores a counted cash-out draft without overwriting a newer draft", () => {
    let state = createDefaultGameState();
    const player = state.players[0];
    const line = {
      denominationId: "blue",
      label: "Blue",
      colorHex: "#0000ff",
      valueCents: 500,
      count: 2
    };
    state.transactions = [
      {
        id: "cash-out",
        type: "bank_cash_out",
        createdAt: "2026-05-10T00:00:20.000Z",
        amountCents: 1000,
        fromPlayerId: player.id,
        chipCountBreakdown: [line]
      }
    ];

    const restored = undoLatest(state, "2026-05-10T00:00:25.000Z");
    expect(restored.cashOutDrafts).toEqual([{ playerId: player.id, lines: [line] }]);

    state.cashOutDrafts = [
      {
        playerId: player.id,
        lines: [{ ...line, count: 4 }]
      }
    ];
    const preserved = undoLatest(state, "2026-05-10T00:00:25.000Z");
    expect(preserved.cashOutDrafts[0].lines[0].count).toBe(4);
  });

  it("allows repeated undo while each exposed creation remains recent", () => {
    let state = createDefaultGameState();
    state.transactions = [
      {
        id: "first",
        type: "bank_buy_in",
        createdAt: "2026-05-10T00:00:10.000Z",
        amountCents: 2000,
        toPlayerId: state.players[0].id
      },
      {
        id: "second",
        type: "bank_buy_in",
        createdAt: "2026-05-10T00:00:20.000Z",
        amountCents: 2000,
        toPlayerId: state.players[1].id
      }
    ];

    state = undoLatest(state, "2026-05-10T00:00:25.000Z");
    expect(state.transactions.map((transaction) => transaction.id)).toEqual(["first"]);
    state = undoLatest(state, "2026-05-10T00:00:25.000Z");
    expect(state.transactions).toEqual([]);
  });

  it("does not partially undo broken linked metadata", () => {
    const state = createDefaultGameState();
    state.transactions = [
      {
        id: "broken",
        type: "bank_buy_in",
        createdAt: "2026-05-10T00:00:20.000Z",
        amountCents: 2000,
        toPlayerId: state.players[0].id,
        flippedFromTransactionId: "missing"
      }
    ];

    expect(
      gameReducer(state, {
        type: "undo_recent_transaction",
        action: {
          kind: "create",
          transactionId: "broken",
          occurredAt: "2026-05-10T00:00:20.000Z"
        },
        requestedAt: "2026-05-10T00:00:25.000Z"
      })
    ).toBe(state);
  });

  it("does not archive players with transactions when reducing player count", () => {
    let state = createDefaultGameState();
    const lastPlayer = state.players[state.players.length - 1];

    state = gameReducer(state, {
      type: "add_transaction",
      transaction: {
        id: "t1",
        type: "bank_buy_in",
        createdAt: "2026-05-10T00:00:00.000Z",
        amountCents: 2000,
        toPlayerId: lastPlayer.id
      }
    });

    state = gameReducer(state, { type: "set_player_count", count: 5 });

    expect(state.players.find((player) => player.id === lastPlayer.id)?.isActive).toBe(true);
  });

  it("clamps player count to the number of players with transactions", () => {
    let state = createDefaultGameState();
    const protectedPlayers = state.players.slice(0, 3);

    for (const [index, player] of protectedPlayers.entries()) {
      state = gameReducer(state, {
        type: "add_transaction",
        transaction: {
          id: `t${index}`,
          type: "bank_buy_in",
          createdAt: "2026-05-10T00:00:00.000Z",
          amountCents: 2000,
          toPlayerId: player.id
        }
      });
    }

    state = gameReducer(state, { type: "set_player_count", count: 1 });

    expect(state.players.filter((player) => player.isActive)).toHaveLength(3);
    expect(
      protectedPlayers.every(
        (protectedPlayer) =>
          state.players.find((player) => player.id === protectedPlayer.id)?.isActive
      )
    ).toBe(true);
  });

  it("does not archive a player with transactions", () => {
    let state = createDefaultGameState();
    const player = state.players[0];

    state = gameReducer(state, {
      type: "add_transaction",
      transaction: {
        id: "t1",
        type: "bank_buy_in",
        createdAt: "2026-05-10T00:00:00.000Z",
        amountCents: 2000,
        toPlayerId: player.id
      }
    });

    state = gameReducer(state, { type: "archive_player", playerId: player.id });

    expect(state.players.find((candidate) => candidate.id === player.id)?.isActive).toBe(true);
  });

  it("protects players referenced only by coverage fields from archiving", () => {
    let state = createDefaultGameState();
    const [coverer, covered] = state.players;
    state = gameReducer(state, {
      type: "add_transaction",
      transaction: {
        id: "coverage",
        type: "debt_coverage",
        createdAt: "2026-05-10T00:00:00.000Z",
        amountCents: 2000,
        coveredPlayerId: covered.id,
        coveredByPlayerId: coverer.id
      }
    });

    state = gameReducer(state, { type: "archive_player", playerId: coverer.id });
    state = gameReducer(state, { type: "archive_player", playerId: covered.id });

    expect(state.players.find((player) => player.id === coverer.id)?.isActive).toBe(true);
    expect(state.players.find((player) => player.id === covered.id)?.isActive).toBe(true);
  });

  it("ignores player moves to non-existent physical seat slots", () => {
    let state = createDefaultGameState();
    const player = state.players[0];

    state = gameReducer(state, {
      type: "move_player_to_seat",
      playerId: player.id,
      seatIndex: 7
    });

    expect(state.players.find((candidate) => candidate.id === player.id)?.seatIndex).toBe(0);
  });

  it("swaps players when moving onto an occupied seat slot", () => {
    let state = createDefaultGameState();
    const [firstPlayer, secondPlayer] = state.players;

    state = gameReducer(state, {
      type: "move_player_to_seat",
      playerId: firstPlayer.id,
      seatIndex: secondPlayer.seatIndex
    });

    expect(state.players.find((player) => player.id === firstPlayer.id)?.seatIndex).toBe(1);
    expect(state.players.find((player) => player.id === secondPlayer.id)?.seatIndex).toBe(0);
  });

  it("adds a player into the lowest unused physical seat slot", () => {
    let state = createDefaultGameState();
    state = gameReducer(state, { type: "add_player", name: "Sam" });

    const addedPlayer = state.players[state.players.length - 1];
    expect(addedPlayer.seatIndex).toBe(6);
    expect(state.settings.tableSeatPlacements.some((placement) => placement.seatIndex === 6))
      .toBe(true);
  });

  it("adds active players beyond twelve", () => {
    let state = createDefaultGameState();

    for (let index = 0; index < 8; index += 1) {
      state = gameReducer(state, { type: "add_player" });
    }

    expect(state.players.filter((player) => player.isActive)).toHaveLength(14);
    expect(state.settings.tableSeatPlacements).toHaveLength(14);
  });

  it("sets player count beyond twelve", () => {
    let state = createDefaultGameState();

    state = gameReducer(state, { type: "set_player_count", count: 16 });

    expect(state.players.filter((player) => player.isActive)).toHaveLength(16);
    expect(state.settings.tableSeatPlacements).toHaveLength(16);
  });

  it("moves physical table seats between rails", () => {
    let state = createDefaultGameState();

    state = gameReducer(state, {
      type: "move_table_seat",
      seatIndex: 1,
      rail: "right",
      order: 0
    });

    expect(state.settings.tableSeatPlacements).toContainEqual({
      seatIndex: 1,
      rail: "right",
      order: 0
    });
  });

  it("preserves valid physical seat indexes when reducing player count", () => {
    let state = createDefaultGameState();
    const protectedPlayer = state.players[0];

    state = gameReducer(state, {
      type: "move_player_to_seat",
      playerId: protectedPlayer.id,
      seatIndex: 5
    });
    state = gameReducer(state, {
      type: "add_transaction",
      transaction: {
        id: "t1",
        type: "bank_buy_in",
        createdAt: "2026-05-10T00:00:00.000Z",
        amountCents: 2000,
        toPlayerId: protectedPlayer.id
      }
    });
    state = gameReducer(state, { type: "set_player_count", count: 5 });

    expect(state.players.find((player) => player.id === protectedPlayer.id)?.seatIndex).toBe(5);
  });

  it("migrates v1 imports to v5 shape and dynamic placements", () => {
    const state = createDefaultGameState();
    const importedState = {
      schemaVersion: 1,
      players: state.players.map((player, index) => ({
        ...player,
        seatIndex: index === 0 ? 7 : player.seatIndex
      })),
      transactions: state.transactions,
      settings: {
        gameName: state.settings.gameName,
        currencyCode: state.settings.currencyCode,
        defaultBuyInCents: state.settings.defaultBuyInCents,
        tableSeatLayout: "round",
        createdAt: state.settings.createdAt
      }
    };

    const nextState = gameReducer(createDefaultGameState(), {
      type: "replace_state_from_import",
      state: importedState as any
    });

    expect(nextState.schemaVersion).toBe(5);
    expect(nextState.settings.tableShape).toBe("round");
    expect(nextState.settings.tableSeatPlacements).toHaveLength(6);
    expect(nextState.settings.chipDenominations).toEqual([]);
    expect(nextState.cashOutDrafts).toEqual([]);
  });

  it("saves chip settings and autosaved player drafts", () => {
    let state = createDefaultGameState();
    const player = state.players[0];
    const denomination = { id: "blue", label: "Blue", colorHex: "#0000ff", valueCents: 500 };

    state = gameReducer(state, { type: "set_chip_denominations", denominations: [denomination] });
    state = gameReducer(state, {
      type: "save_cash_out_draft",
      draft: {
        playerId: player.id,
        lines: [{ denominationId: "blue", label: "Blue", colorHex: "#0000ff", valueCents: 500, count: 3 }]
      }
    });

    expect(state.settings.chipDenominations).toEqual([denomination]);
    expect(state.cashOutDrafts[0].lines[0].count).toBe(3);

    const editedDenomination = {
      ...denomination,
      label: "Navy",
      colorHex: "#000080",
      valueCents: 1000
    };
    state = gameReducer(state, {
      type: "set_chip_denominations",
      denominations: [editedDenomination]
    });
    expect(state.cashOutDrafts[0].lines[0]).toEqual({
      denominationId: "blue",
      label: "Navy",
      colorHex: "#000080",
      valueCents: 1000,
      count: 3
    });

    state = gameReducer(state, { type: "clear_cash_out_draft", playerId: player.id });
    expect(state.cashOutDrafts).toEqual([]);
  });

  it("records a counted cash-out and atomically replaces a correction", () => {
    let state = createDefaultGameState();
    const player = state.players[0];
    const original = {
      id: "cashout",
      type: "bank_cash_out" as const,
      cashOutKind: "final" as const,
      createdAt: "2026-05-10T00:00:00.000Z",
      amountCents: 1000,
      fromPlayerId: player.id,
      chipCountBreakdown: [
        { denominationId: "blue", label: "Blue", colorHex: "#0000ff", valueCents: 500, count: 2 }
      ]
    };
    state = gameReducer(state, { type: "record_cash_out", transaction: original });
    state = gameReducer(state, {
      type: "start_cash_out_correction",
      playerId: player.id,
      transactionId: original.id
    });
    expect(state.cashOutDrafts[0].correctingTransactionId).toBe(original.id);

    state = gameReducer(state, {
      type: "replace_cash_out",
      originalTransactionId: original.id,
      replacement: {
        ...original,
        id: "corrected",
        amountCents: 1500,
        correctsTransactionId: original.id,
        chipCountBreakdown: [
          { denominationId: "blue", label: "Blue", colorHex: "#0000ff", valueCents: 500, count: 3 }
        ]
      }
    });

    expect(state.transactions[0]).toEqual(expect.objectContaining({ voidReason: "Corrected chip count" }));
    expect(state.transactions[1]).toEqual(expect.objectContaining({ id: "corrected", correctsTransactionId: "cashout" }));
    expect(state.cashOutDrafts).toEqual([]);
  });

  it("refuses to replace a voided cash-out", () => {
    let state = createDefaultGameState();
    const player = state.players[0];
    state = gameReducer(state, {
      type: "add_transaction",
      transaction: {
        id: "cashout",
        type: "bank_cash_out",
        cashOutKind: "final",
        createdAt: "2026-05-10T00:00:00.000Z",
        amountCents: 0,
        fromPlayerId: player.id,
        voidedAt: "2026-05-11T00:00:00.000Z"
      }
    });
    const before = state;
    state = gameReducer(state, {
      type: "replace_cash_out",
      originalTransactionId: "cashout",
      replacement: {
        id: "replacement",
        type: "bank_cash_out",
        cashOutKind: "final",
        createdAt: "2026-05-12T00:00:00.000Z",
        amountCents: 0,
        fromPlayerId: player.id,
        chipCountBreakdown: []
      }
    });
    expect(state).toBe(before);
  });

  it("flips a player transfer by voiding the original and adding the reversed copy", () => {
    let state = createDefaultGameState();
    const [fromPlayer, toPlayer] = state.players;

    state = gameReducer(state, {
      type: "add_transaction",
      transaction: {
        id: "transfer",
        type: "player_transfer",
        createdAt: "2026-05-10T00:00:00.000Z",
        amountCents: 1500,
        fromPlayerId: fromPlayer.id,
        toPlayerId: toPlayer.id,
        category: "food",
        note: "Food"
      }
    });

    state = gameReducer(state, { type: "flip_transaction", transactionId: "transfer" });

    expect(state.transactions).toHaveLength(2);
    expect(state.transactions[0].voidedAt).toBeTruthy();
    expect(state.transactions[0].voidReason).toBe("Flipped transaction");
    expect(state.transactions[1]).toEqual(
      expect.objectContaining({
        type: "player_transfer",
        amountCents: 1500,
        fromPlayerId: toPlayer.id,
        toPlayerId: fromPlayer.id,
        category: "food",
        note: "Food",
        flippedFromTransactionId: "transfer"
      })
    );
  });

  it("flips bank buy-ins into cash-outs for the same player", () => {
    let state = createDefaultGameState();
    const player = state.players[0];

    state = gameReducer(state, {
      type: "add_transaction",
      transaction: {
        id: "buy-in",
        type: "bank_buy_in",
        createdAt: "2026-05-10T00:00:00.000Z",
        amountCents: 2000,
        toPlayerId: player.id
      }
    });

    state = gameReducer(state, { type: "flip_transaction", transactionId: "buy-in" });

    expect(state.transactions[1]).toEqual(
      expect.objectContaining({
        type: "bank_cash_out",
        cashOutKind: "partial",
        amountCents: 2000,
        fromPlayerId: player.id,
        toPlayerId: undefined,
        flippedFromTransactionId: "buy-in"
      })
    );
  });

  it("clears coverage metadata when flipping a covered buy-in", () => {
    let state = createDefaultGameState();
    const [coverer, recipient] = state.players;
    state = gameReducer(state, {
      type: "add_transaction",
      transaction: {
        id: "covered-buy-in",
        type: "bank_buy_in",
        createdAt: "2026-05-10T00:00:00.000Z",
        amountCents: 2000,
        toPlayerId: recipient.id,
        coveredByPlayerId: coverer.id
      }
    });

    state = gameReducer(state, {
      type: "flip_transaction",
      transactionId: "covered-buy-in"
    });

    expect(state.transactions[1]).toMatchObject({
      type: "bank_cash_out",
      fromPlayerId: recipient.id,
      coveredByPlayerId: undefined
    });
  });

  it("does not flip debt coverage", () => {
    let state = createDefaultGameState();
    const [coverer, covered] = state.players;
    state = gameReducer(state, {
      type: "add_transaction",
      transaction: {
        id: "coverage",
        type: "debt_coverage",
        createdAt: "2026-05-10T00:00:00.000Z",
        amountCents: 2000,
        coveredPlayerId: covered.id,
        coveredByPlayerId: coverer.id
      }
    });

    const next = gameReducer(state, {
      type: "flip_transaction",
      transactionId: "coverage"
    });
    expect(next).toBe(state);
  });
});
