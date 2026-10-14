import type {
  AnyPersistedGameState,
  GameState,
  Player,
  Transaction,
  TableSeatLayout,
  TableShape
} from "../domain/pokerTypes";
import {
  createDefaultSeatPlacements,
  normalizeSeatPlacements
} from "../domain/tableLayout";
import { normalizeLegacyPlayerTransactions } from "../domain/playerTransactions";
import { isValidPersonId } from "../domain/people";
import { sanitizeSettlementPins } from "../domain/settlement";
import { validatePersistedState } from "../domain/validation";
import { createDefaultGameState, createId } from "./seedGame";
import {
  quarantineRaw,
  readStoredJson,
  reasonForInvalid,
  releaseQuarantinedRaw
} from "./storageQuarantine";

export const STORAGE_KEY = "poker-tracker:v1:current-game";
/** Highest saved-game schema this build can read. */
export const CURRENT_SCHEMA_VERSION = 7;

function shapeFromLegacyLayout(layout: TableSeatLayout | undefined): TableShape {
  if (layout === "round") {
    return "round";
  }

  if (layout === "top_bottom" || layout === "left_right") {
    return "oval";
  }

  return "rectangle";
}

function activeSeatIndexes(players: Player[]): number[] {
  return players
    .filter((player) => player.isActive)
    .map((player) => player.seatIndex)
    .sort((a, b) => a - b);
}

function resetActiveSeatIndexes(players: Player[]): Player[] {
  const activePlayers = [...players]
    .filter((player) => player.isActive)
    .sort((a, b) => a.seatIndex - b.seatIndex);
  const nextSeatByPlayerId = new Map(
    activePlayers.map((player, seatIndex) => [player.id, seatIndex])
  );

  return players.map((player) =>
    player.isActive
      ? { ...player, seatIndex: nextSeatByPlayerId.get(player.id) ?? player.seatIndex }
      : player
  );
}

function transactionTimestamp(transaction: Transaction): number {
  const timestamp = Date.parse(transaction.createdAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function classifyLegacyCashOuts(transactions: Transaction[]): Transaction[] {
  const inferredKinds = new Map<string, "partial" | "final">();
  const activeByPlayer = new Map<string, Array<{ transaction: Transaction; index: number }>>();

  for (const [index, transaction] of transactions.entries()) {
    if (
      transaction.type !== "bank_cash_out" ||
      transaction.voidedAt ||
      transaction.cashOutKind ||
      !transaction.fromPlayerId
    ) {
      continue;
    }

    const current = activeByPlayer.get(transaction.fromPlayerId) ?? [];
    current.push({ transaction, index });
    activeByPlayer.set(transaction.fromPlayerId, current);
  }

  for (const cashOuts of activeByPlayer.values()) {
    cashOuts.sort((left, right) => {
      const timestampDifference =
        transactionTimestamp(left.transaction) - transactionTimestamp(right.transaction);
      return timestampDifference || left.index - right.index;
    });

    for (const { transaction } of cashOuts) inferredKinds.set(transaction.id, "partial");
    const latest = cashOuts[cashOuts.length - 1];
    if (latest) inferredKinds.set(latest.transaction.id, "final");
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const transaction of transactions) {
      if (transaction.type !== "bank_cash_out" || !transaction.correctsTransactionId) continue;
      const kind = transaction.cashOutKind ?? inferredKinds.get(transaction.id);
      if (kind && !inferredKinds.has(transaction.correctsTransactionId)) {
        inferredKinds.set(transaction.correctsTransactionId, kind);
        changed = true;
      }
    }
  }

  return transactions.map((transaction) =>
    transaction.type === "bank_cash_out"
      ? {
          ...transaction,
          cashOutKind: transaction.cashOutKind ?? inferredKinds.get(transaction.id) ?? "partial"
        }
      : transaction
  );
}

function finishMigration(
  state: Omit<GameState, "schemaVersion" | "localGameId">,
  localGameId = createId("game")
): GameState {
  return {
    ...state,
    schemaVersion: 7,
    localGameId,
    transactions: normalizeLegacyPlayerTransactions(classifyLegacyCashOuts(state.transactions))
  };
}

/**
 * Player.personId is optional and additive, so saves keep schema 7 and older
 * builds still open them. Validation tolerates any value there (a newer build
 * might format ids differently); ids this build cannot use are dropped here.
 */
function withUsablePersonIds(state: GameState): GameState {
  if (state.players.every((player) => player.personId === undefined || isValidPersonId(player.personId))) {
    return state;
  }
  return {
    ...state,
    players: state.players.map((player) => {
      if (player.personId === undefined || isValidPersonId(player.personId)) return player;
      const { personId: _personId, ...rest } = player;
      return rest;
    })
  };
}

/**
 * settlementPins is optional and additive like Player.personId: validation
 * ignores it and pins this build cannot use are dropped here.
 */
function withUsableSettlementPins(state: GameState): GameState {
  const { settlementPins, ...rest } = state;
  if (settlementPins === undefined) return state;
  const pins = sanitizeSettlementPins(settlementPins, state.players);
  return pins.length > 0 ? { ...rest, settlementPins: pins } : rest;
}

export function migratePersistedState(state: AnyPersistedGameState): GameState {
  return withUsableSettlementPins(withUsablePersonIds(migrateSchema(state)));
}

function migrateSchema(state: AnyPersistedGameState): GameState {
  if (state.schemaVersion === 7) {
    return {
      ...state,
      settings: {
        ...state.settings,
        tableSeatPlacements: normalizeSeatPlacements(
          state.settings.tableSeatPlacements,
          activeSeatIndexes(state.players),
          state.settings.tableShape
        )
      },
      transactions: normalizeLegacyPlayerTransactions(state.transactions)
    };
  }

  if (state.schemaVersion === 6) {
    return finishMigration(
      {
        settings: {
          ...state.settings,
          tableSeatPlacements: normalizeSeatPlacements(
            state.settings.tableSeatPlacements,
            activeSeatIndexes(state.players),
            state.settings.tableShape
          )
        },
        players: state.players,
        transactions: state.transactions,
        cashOutDrafts: state.cashOutDrafts
      },
      state.localGameId
    );
  }

  if (state.schemaVersion === 5) {
    return finishMigration({
      settings: {
        ...state.settings,
        tableSeatPlacements: normalizeSeatPlacements(
          state.settings.tableSeatPlacements,
          activeSeatIndexes(state.players),
          state.settings.tableShape
        )
      },
      players: state.players,
      transactions: state.transactions,
      cashOutDrafts: state.cashOutDrafts
    });
  }

  if (state.schemaVersion === 4) {
    return finishMigration({
      settings: {
        ...state.settings,
        tableSeatPlacements: normalizeSeatPlacements(
          state.settings.tableSeatPlacements,
          activeSeatIndexes(state.players),
          state.settings.tableShape
        )
      },
      players: state.players,
      transactions: state.transactions,
      cashOutDrafts: state.cashOutDrafts
    });
  }

  if (state.schemaVersion === 3) {
    return finishMigration({
      settings: {
        ...state.settings,
        tableSeatPlacements: normalizeSeatPlacements(
          state.settings.tableSeatPlacements,
          activeSeatIndexes(state.players),
          state.settings.tableShape
        )
      },
      players: state.players,
      transactions: state.transactions,
      cashOutDrafts: state.cashOutDrafts
    });
  }

  if (state.schemaVersion === 2) {
    return finishMigration({
      settings: {
        ...state.settings,
        chipDenominations: [],
        tableSeatPlacements: normalizeSeatPlacements(
          state.settings.tableSeatPlacements,
          activeSeatIndexes(state.players),
          state.settings.tableShape
        )
      },
      players: state.players,
      transactions: state.transactions,
      cashOutDrafts: []
    });
  }

  const players = resetActiveSeatIndexes(state.players);
  const activeCount = players.filter((player) => player.isActive).length;
  const tableShape = shapeFromLegacyLayout(state.settings.tableSeatLayout);

  return finishMigration({
    settings: {
      gameName: state.settings.gameName,
      currencyCode: state.settings.currencyCode,
      defaultBuyInCents: state.settings.defaultBuyInCents,
      tableShape,
      tableSeatPlacements: createDefaultSeatPlacements(activeCount, tableShape),
      chipDenominations: [],
      createdAt: state.settings.createdAt
    },
    players,
    transactions: state.transactions,
    cashOutDrafts: []
  });
}

export function loadSavedGameState(): GameState | null {
  const stored = readStoredJson(STORAGE_KEY);
  if (!stored) {
    return null;
  }

  if (!validatePersistedState(stored.value)) {
    // Keep a copy before the next save can replace it; a newer build's save is the usual cause.
    quarantineRaw(
      STORAGE_KEY,
      stored.raw,
      reasonForInvalid(stored.value, CURRENT_SCHEMA_VERSION)
    );
    return null;
  }

  try {
    const state = migratePersistedState(stored.value);
    // The same value reads cleanly again (e.g. after updating), so any earlier copy is redundant.
    releaseQuarantinedRaw(STORAGE_KEY, stored.raw);
    return state;
  } catch {
    quarantineRaw(STORAGE_KEY, stored.raw, "invalid");
    return null;
  }
}

export function loadGameState(): GameState {
  return loadSavedGameState() ?? createDefaultGameState();
}

export function saveGameState(state: GameState): void {
  if (typeof localStorage === "undefined") {
    return;
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function trySaveGameState(state: GameState): boolean {
  try {
    saveGameState(state);
    return true;
  } catch {
    return false;
  }
}
