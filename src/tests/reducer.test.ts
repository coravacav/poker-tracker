import { describe, expect, it } from "vitest";
import { gameReducer } from "../state/gameReducer";
import { createDefaultGameState } from "../state/seedGame";

describe("gameReducer", () => {
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

  it("moves a player to an empty physical seat slot", () => {
    let state = createDefaultGameState();
    const player = state.players[0];

    state = gameReducer(state, {
      type: "move_player_to_seat",
      playerId: player.id,
      seatIndex: 7
    });

    expect(state.players.find((candidate) => candidate.id === player.id)?.seatIndex).toBe(7);
    expect(state.players.some((candidate) => candidate.seatIndex === 0)).toBe(false);
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

  it("adds a player into the lowest empty physical seat slot", () => {
    let state = createDefaultGameState();
    const player = state.players[0];

    state = gameReducer(state, {
      type: "move_player_to_seat",
      playerId: player.id,
      seatIndex: 7
    });
    state = gameReducer(state, { type: "add_player", name: "Sam" });

    const addedPlayer = state.players[state.players.length - 1];
    expect(addedPlayer.seatIndex).toBe(0);
  });

  it("does not add more than twelve active players", () => {
    let state = createDefaultGameState();

    for (let index = 0; index < 8; index += 1) {
      state = gameReducer(state, { type: "add_player" });
    }

    expect(state.players.filter((player) => player.isActive)).toHaveLength(12);
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

  it("defaults missing corner-seat import settings to enabled", () => {
    const state = createDefaultGameState();
    const importedState = {
      ...state,
      players: state.players.map((player, index) => ({
        ...player,
        seatIndex: index === 0 ? 7 : player.seatIndex
      })),
      settings: {
        gameName: state.settings.gameName,
        currencyCode: state.settings.currencyCode,
        defaultBuyInCents: state.settings.defaultBuyInCents,
        tableSeatLayout: state.settings.tableSeatLayout,
        createdAt: state.settings.createdAt
      }
    };

    const nextState = gameReducer(createDefaultGameState(), {
      type: "replace_state_from_import",
      state: importedState as any
    });

    expect(nextState.settings.tableIncludeCornerSeats).toBe(true);
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
        amountCents: 2000,
        fromPlayerId: player.id,
        toPlayerId: undefined,
        flippedFromTransactionId: "buy-in"
      })
    );
  });
});
