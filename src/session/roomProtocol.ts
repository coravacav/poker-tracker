import type { GameState, Transaction } from "../domain/pokerTypes";
import { normalizeLegacyPlayerTransaction } from "../domain/playerTransactions";
import { validatePersistedState } from "../domain/validation";
import { gameReducer, type GameAction } from "../state/gameReducer";

export const MAX_ROOM_SNAPSHOT_BYTES = 700_000;
export const MAX_ROOM_TRANSACTIONS = 5_000;
export const MAX_ROOM_ACTIONS = 10_000;
export const MAX_ROOM_GUESTS = 50;
export const MAX_ROOM_PLAYERS = 24;

const HOSTED_ACTION_TYPES = new Set<GameAction["type"]>([
  "set_game_name",
  "set_default_buy_in",
  "set_chip_denominations",
  "set_table_shape",
  "move_table_seat",
  "move_player_to_seat",
  "set_player_count",
  "add_player",
  "replace_active_players",
  "rename_player",
  "archive_player",
  "reorder_players",
  "add_transaction",
  "add_transactions",
  "save_cash_out_draft",
  "clear_cash_out_draft",
  "start_cash_out_correction",
  "record_cash_out",
  "replace_cash_out",
  "flip_transaction",
  "void_transaction",
  "undo_recent_transaction"
]);

function jsonSize(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function normalizeGameState(state: GameState): GameState {
  const normalized: GameState = {
    schemaVersion: 7,
    localGameId: state.localGameId,
    settings: {
      gameName: state.settings.gameName,
      currencyCode: "USD",
      defaultBuyInCents: state.settings.defaultBuyInCents,
      tableShape: state.settings.tableShape,
      tableSeatPlacements: state.settings.tableSeatPlacements.map(({ seatIndex, rail, order }) => ({
        seatIndex,
        rail,
        order
      })),
      chipDenominations: state.settings.chipDenominations.map(
        ({ id, label, colorHex, valueCents }) => ({ id, label, colorHex, valueCents })
      ),
      createdAt: state.settings.createdAt
    },
    players: state.players.map(({ id, name, seatIndex, isActive }) => ({
      id,
      name,
      seatIndex,
      isActive
    })),
    transactions: state.transactions.map(
      ({
        id,
        type,
        createdAt,
        amountCents,
        fromPlayerId,
        toPlayerId,
        coveredByPlayerId,
        coveredPlayerId,
        bankDirection,
        category,
        cashOutKind,
        note,
        flippedFromTransactionId,
        chipCountBreakdown,
        correctsTransactionId,
        voidedAt,
        voidReason
      }) =>
        normalizeLegacyPlayerTransaction({
          id,
          type,
          createdAt,
          amountCents,
          fromPlayerId,
          toPlayerId,
          coveredByPlayerId,
          coveredPlayerId,
          bankDirection,
          category,
          cashOutKind,
          note,
          flippedFromTransactionId,
          chipCountBreakdown: chipCountBreakdown?.map(
            ({ denominationId, label, colorHex, valueCents, count }) => ({
              denominationId,
              label,
              colorHex,
              valueCents,
              count
            })
          ),
          correctsTransactionId,
          voidedAt,
          voidReason
        })
    ),
    cashOutDrafts: state.cashOutDrafts.map(({ playerId, lines, correctingTransactionId }) => ({
      playerId,
      lines: lines.map(({ denominationId, label, colorHex, valueCents, count }) => ({
        denominationId,
        label,
        colorHex,
        valueCents,
        count
      })),
      correctingTransactionId
    }))
  };
  return JSON.parse(JSON.stringify(normalized)) as GameState;
}

export function roomStateError(state: unknown): string | null {
  if (
    !validatePersistedState(state) ||
    (state.schemaVersion !== 6 && state.schemaVersion !== 7)
  ) {
    return "Game state does not match the current schema.";
  }
  if (state.players.length > MAX_ROOM_PLAYERS) {
    return `Shared games support at most ${MAX_ROOM_PLAYERS} players.`;
  }
  if (state.transactions.length > MAX_ROOM_TRANSACTIONS) {
    return `Shared games support at most ${MAX_ROOM_TRANSACTIONS} transactions.`;
  }
  if (jsonSize(state) > MAX_ROOM_SNAPSHOT_BYTES) {
    return "The game is too large to share as a room snapshot.";
  }
  return null;
}

function withServerTransactionMetadata(
  transaction: unknown,
  nowIso: string,
  createTransactionId: () => string
): Transaction | null {
  if (!transaction || typeof transaction !== "object") return null;
  return {
    ...(transaction as Transaction),
    id: createTransactionId(),
    createdAt: nowIso
  };
}

export function applyHostedAction(
  state: GameState,
  actionValue: unknown,
  nowIso: string,
  createTransactionId: () => string
): { state: GameState } | { error: string } {
  if (!actionValue || typeof actionValue !== "object") {
    return { error: "Action must be an object." };
  }

  const candidate = actionValue as { type?: unknown; [key: string]: unknown };
  if (
    typeof candidate.type !== "string" ||
    !HOSTED_ACTION_TYPES.has(candidate.type as GameAction["type"])
  ) {
    return { error: "That action is not allowed in a shared room." };
  }

  if (jsonSize(candidate) > 100_000) {
    return { error: "Action payload is too large." };
  }

  let action: GameAction;
  if (candidate.type === "add_transaction" || candidate.type === "record_cash_out") {
    const transaction = withServerTransactionMetadata(
      candidate.transaction,
      nowIso,
      createTransactionId
    );
    if (!transaction) return { error: "Transaction details are required." };
    action = { ...candidate, transaction } as GameAction;
  } else if (candidate.type === "add_transactions") {
    if (!Array.isArray(candidate.transactions) || candidate.transactions.length > MAX_ROOM_PLAYERS) {
      return { error: "Enter a valid bounded transaction batch." };
    }
    const transactions = candidate.transactions.map((transaction) =>
      withServerTransactionMetadata(transaction, nowIso, createTransactionId)
    );
    if (transactions.some((transaction) => transaction === null)) {
      return { error: "Every transaction in the batch must be valid." };
    }
    action = { type: "add_transactions", transactions: transactions as Transaction[] };
  } else if (candidate.type === "replace_cash_out") {
    const replacement = withServerTransactionMetadata(
      candidate.replacement,
      nowIso,
      createTransactionId
    );
    if (!replacement || typeof candidate.originalTransactionId !== "string") {
      return { error: "Cash-out replacement details are required." };
    }
    action = {
      type: "replace_cash_out",
      originalTransactionId: candidate.originalTransactionId,
      replacement
    };
  } else if (candidate.type === "undo_recent_transaction") {
    action = { ...candidate, requestedAt: nowIso } as GameAction;
  } else {
    action = candidate as GameAction;
  }

  try {
    const currentState = normalizeGameState(state);
    const nextState = normalizeGameState(gameReducer(currentState, action));
    if (JSON.stringify(nextState) === JSON.stringify(currentState)) {
      return { error: "The action did not apply to the current room state." };
    }
    const validationError = roomStateError(nextState);
    return validationError ? { error: validationError } : { state: nextState };
  } catch {
    return { error: "Action payload is invalid." };
  }
}

export function sanitizeGuestState(state: GameState): GameState {
  const normalized = normalizeGameState(state);
  return {
    ...normalized,
    cashOutDrafts: []
  };
}
