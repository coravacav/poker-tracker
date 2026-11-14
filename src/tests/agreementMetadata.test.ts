import { describe, expect, it } from "vitest";
import type { GameState, Transaction } from "../domain/pokerTypes";
import { repeatTransaction } from "../domain/quickEntry";
import { validatePersistedState, validateTransaction } from "../domain/validation";
import {
  applyHostedAction,
  isRebaseableHostedAction,
  normalizeGameState,
  roomStateError,
  sanitizeGuestState
} from "../session/roomProtocol";
import { gameReducer } from "../state/gameReducer";
import { loadSavedGameState, migratePersistedState, STORAGE_KEY } from "../state/persistence";
import { createDefaultGameState } from "../state/seedGame";

const METADATA_KEYS = ["proposedByPlayerId", "confirmedByPlayerId", "agreementId", "confirmedVia"];

function gameWith(transactions: (state: GameState) => Transaction[]): GameState {
  const state = createDefaultGameState();
  return { ...state, transactions: transactions(state) };
}

function agreedGift(state: GameState, extra: Partial<Transaction> = {}): Transaction {
  const [maya, jon] = state.players;
  return {
    id: "transaction_agreed",
    type: "player_gave",
    createdAt: "2026-11-14T20:00:00.000Z",
    amountCents: 2000,
    fromPlayerId: maya.id,
    toPlayerId: jon.id,
    category: "poker",
    proposedByPlayerId: maya.id,
    confirmedByPlayerId: jon.id,
    agreementId: "agreement_abc",
    confirmedVia: "peer",
    ...extra
  };
}

function expectNoMetadata(transaction: Transaction | undefined) {
  for (const key of METADATA_KEYS) expect(transaction).not.toHaveProperty(key);
}

describe("transaction agreement metadata", () => {
  it("validates who proposed and confirmed an agreed entry", () => {
    const state = createDefaultGameState();
    const [maya, jon, dev] = state.players;
    const players = state.players;
    expect(validateTransaction(agreedGift(state), players)).toBeNull();
    expect(
      validateTransaction(
        {
          id: "transaction_bank",
          type: "bank_buy_in",
          createdAt: "2026-11-14T20:00:00.000Z",
          amountCents: 2000,
          toPlayerId: maya.id,
          proposedByPlayerId: maya.id,
          confirmedByPlayerId: dev.id,
          agreementId: "agreement_bank",
          confirmedVia: "peer"
        },
        players
      )
    ).toBeNull();

    expect(
      validateTransaction(agreedGift(state, { type: "player_owes" }), players)
    ).toMatch(/only valid for player gifts and buy-ins/);
    expect(
      validateTransaction(agreedGift(state, { proposedByPlayerId: "player_missing" }), players)
    ).toMatch(/proposing player/);
    expect(
      validateTransaction(agreedGift(state, { confirmedByPlayerId: "player_missing" }), players)
    ).toMatch(/confirming player/);
    expect(
      validateTransaction(agreedGift(state, { confirmedByPlayerId: maya.id }), players)
    ).toMatch(/cannot confirm their own/);
    expect(
      validateTransaction(agreedGift(state, { agreementId: "" }), players)
    ).toMatch(/agreement reference/);
    expect(
      validateTransaction(agreedGift(state, { confirmedVia: "email" as never }), players)
    ).toMatch(/how the entry was confirmed/);
    expect(validateTransaction(agreedGift(state, { confirmedByPlayerId: jon.id }), players)).toBeNull();
  });

  it("keeps usable metadata in room snapshots and guest views, and drops the rest", () => {
    const state = gameWith((game) => [
      agreedGift(game),
      agreedGift(game, { id: "transaction_bad", confirmedByPlayerId: "player_missing" })
    ]);
    expect(roomStateError(state)).toBeNull();
    const normalized = normalizeGameState(state);
    expect(normalized.transactions[0]).toEqual(agreedGift(state));
    expect(normalized.transactions[1]).toMatchObject({ id: "transaction_bad", amountCents: 2000 });
    expectNoMetadata(normalized.transactions[1]);
    expect(sanitizeGuestState(state).transactions[0]).toEqual(agreedGift(state));
  });

  it("strips metadata from transactions a host or guest submits", () => {
    const state = createDefaultGameState();
    const submitted = agreedGift(state);
    const single = applyHostedAction(
      state,
      { type: "add_transaction", transaction: submitted },
      "2026-11-14T21:00:00.000Z",
      () => "transaction_server"
    );
    if ("error" in single) throw new Error(single.error);
    expect(single.state.transactions[0]).toMatchObject({ id: "transaction_server", type: "player_gave" });
    expectNoMetadata(single.state.transactions[0]);

    let next = 0;
    const batch = applyHostedAction(
      state,
      { type: "add_transactions", transactions: [submitted, submitted] },
      "2026-11-14T21:00:00.000Z",
      () => `transaction_server_${next++}`
    );
    if ("error" in batch) throw new Error(batch.error);
    batch.state.transactions.forEach(expectNoMetadata);

    const trusted = applyHostedAction(
      state,
      { type: "add_transaction", transaction: submitted },
      "2026-11-14T21:00:00.000Z",
      () => "transaction_server",
      { trustAgreementMetadata: true }
    );
    if ("error" in trusted) throw new Error(trusted.error);
    expect(trusted.state.transactions[0]).toMatchObject({
      proposedByPlayerId: submitted.proposedByPlayerId,
      confirmedByPlayerId: submitted.confirmedByPlayerId,
      agreementId: "agreement_abc",
      confirmedVia: "peer"
    });

    const invalidTrusted = applyHostedAction(
      state,
      {
        type: "add_transaction",
        transaction: agreedGift(state, { confirmedByPlayerId: submitted.proposedByPlayerId })
      },
      "2026-11-14T21:00:00.000Z",
      () => "transaction_server",
      { trustAgreementMetadata: true }
    );
    if ("error" in invalidTrusted) throw new Error(invalidTrusted.error);
    expectNoMetadata(invalidTrusted.state.transactions[0]);
  });

  it("does not carry metadata onto a flipped or repeated entry", () => {
    const state = gameWith((game) => [agreedGift(game)]);
    const flipped = gameReducer(state, { type: "flip_transaction", transactionId: "transaction_agreed" });
    expect(flipped.transactions).toHaveLength(2);
    expect(flipped.transactions[0]).toMatchObject({ voidReason: "Flipped transaction", agreementId: "agreement_abc" });
    expect(flipped.transactions[1].flippedFromTransactionId).toBe("transaction_agreed");
    for (const key of METADATA_KEYS) {
      expect(flipped.transactions[1][key as keyof Transaction]).toBeUndefined();
    }

    const repeated = repeatTransaction(state.transactions[0], "transaction_repeat", "2026-11-14T22:00:00.000Z");
    for (const key of METADATA_KEYS) {
      expect(repeated[key as keyof Transaction]).toBeUndefined();
    }
  });

  it("loads saves with unusable metadata instead of rejecting them", () => {
    const state = gameWith((game) => [
      agreedGift(game),
      agreedGift(game, { id: "transaction_owes", type: "player_owes" }),
      agreedGift(game, { id: "transaction_self", confirmedByPlayerId: game.players[0].id })
    ]);
    expect(validatePersistedState(state)).toBe(true);
    const migrated = migratePersistedState(state);
    expect(migrated.schemaVersion).toBe(7);
    expect(migrated.transactions[0]).toEqual(agreedGift(state));
    expectNoMetadata(migrated.transactions[1]);
    expectNoMetadata(migrated.transactions[2]);

    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    const loaded = loadSavedGameState();
    expect(loaded?.transactions).toHaveLength(3);
    expect(loaded?.transactions[0].confirmedByPlayerId).toBe(state.players[1].id);
    expectNoMetadata(loaded?.transactions[2]);
  });
});

describe("rebaseable host actions", () => {
  it("rebases only actions that target ids or add", () => {
    for (const type of [
      "add_transaction",
      "add_transactions",
      "record_cash_out",
      "replace_cash_out",
      "save_cash_out_draft",
      "clear_cash_out_draft",
      "void_transaction",
      "flip_transaction",
      "pin_settlement_payment",
      "set_settlement_pin_status",
      "unpin_settlement_payment",
      "clear_settlement_pins",
      "set_game_name",
      "rename_player"
    ]) {
      expect(isRebaseableHostedAction({ type })).toBe(true);
    }
    for (const type of [
      "undo_recent_transaction",
      "set_player_count",
      "replace_active_players",
      "archive_player",
      "reorder_players",
      "move_player_to_seat",
      "move_table_seat",
      "replace_state_from_import",
      "reset_game"
    ]) {
      expect(isRebaseableHostedAction({ type })).toBe(false);
    }
    expect(isRebaseableHostedAction(null)).toBe(false);
    expect(isRebaseableHostedAction({})).toBe(false);
  });
});
