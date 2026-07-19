import type {
  AnyPersistedGameState,
  CashOutDraft,
  ChipCountLine,
  ChipDenomination,
  Player,
  SeatRail,
  TableSeatPlacement,
  TableShape,
  Transaction,
  TransactionType
} from "./pokerTypes";
import { chipCountTotalCents } from "./chipCounts";

const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

export function isValidChipDenomination(value: unknown): value is ChipDenomination {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ChipDenomination>;
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.label === "string" &&
    candidate.label.trim().length > 0 &&
    typeof candidate.colorHex === "string" &&
    COLOR_PATTERN.test(candidate.colorHex) &&
    typeof candidate.valueCents === "number" &&
    Number.isSafeInteger(candidate.valueCents) &&
    candidate.valueCents > 0
  );
}

export function isValidChipCountLine(value: unknown): value is ChipCountLine {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ChipCountLine>;
  return (
    typeof candidate.denominationId === "string" &&
    candidate.denominationId.length > 0 &&
    typeof candidate.label === "string" &&
    candidate.label.trim().length > 0 &&
    typeof candidate.colorHex === "string" &&
    COLOR_PATTERN.test(candidate.colorHex) &&
    typeof candidate.valueCents === "number" &&
    Number.isSafeInteger(candidate.valueCents) &&
    candidate.valueCents > 0 &&
    typeof candidate.count === "number" &&
    Number.isSafeInteger(candidate.count) &&
    candidate.count > 0
  );
}

function isValidCashOutDraft(value: unknown): value is CashOutDraft {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CashOutDraft>;
  return (
    typeof candidate.playerId === "string" &&
    Array.isArray(candidate.lines) &&
    candidate.lines.every(isValidChipCountLine) &&
    new Set(candidate.lines.map((line) => line.denominationId)).size === candidate.lines.length &&
    (candidate.correctingTransactionId === undefined ||
      typeof candidate.correctingTransactionId === "string")
  );
}

export function validateTransaction(
  transaction: Transaction,
  players: Player[]
): string | null {
  const playerIds = new Set(players.map((player) => player.id));

  if (!TRANSACTION_TYPES.has(transaction.type)) {
    return "Choose a valid transaction type.";
  }

  if (!Number.isSafeInteger(transaction.amountCents)) {
    return "Amount must be a whole number of cents within the supported range.";
  }

  if (transaction.amountCents < 0) {
    return "Amount cannot be negative.";
  }

  if (transaction.amountCents === 0 && transaction.type !== "bank_cash_out") {
    return "Amount must be greater than zero.";
  }

  if (transaction.type === "bank_buy_in" && !transaction.toPlayerId) {
    return "Choose the player receiving chips.";
  }

  if (
    transaction.type === "bank_buy_in" &&
    transaction.toPlayerId &&
    !playerIds.has(transaction.toPlayerId)
  ) {
    return "The chip buy-in player does not exist.";
  }

  if (
    transaction.type === "bank_buy_in" &&
    transaction.coveredByPlayerId !== undefined
  ) {
    if (!playerIds.has(transaction.coveredByPlayerId)) {
      return "The player covering the buy-in does not exist.";
    }

    if (transaction.coveredByPlayerId === transaction.toPlayerId) {
      return "Choose a different player to cover the buy-in.";
    }
  }

  if (transaction.type === "bank_cash_out" && !transaction.fromPlayerId) {
    return "Choose the player returning chips.";
  }

  if (transaction.cashOutKind !== undefined) {
    if (transaction.type !== "bank_cash_out") {
      return "Cash-out kind is only valid for cash-outs.";
    }
    if (transaction.cashOutKind !== "partial" && transaction.cashOutKind !== "final") {
      return "Choose a valid cash-out kind.";
    }
    if (transaction.cashOutKind === "partial" && transaction.amountCents === 0) {
      return "A partial cash-out must be greater than zero.";
    }
  }

  if (
    transaction.type === "bank_cash_out" &&
    transaction.fromPlayerId &&
    !playerIds.has(transaction.fromPlayerId)
  ) {
    return "The chip cash-out player does not exist.";
  }

  if (transaction.type === "player_transfer") {
    if (!transaction.fromPlayerId || !transaction.toPlayerId) {
      return "Choose both players for the transfer.";
    }

    if (transaction.fromPlayerId === transaction.toPlayerId) {
      return "A player cannot transfer to themselves.";
    }

    if (!playerIds.has(transaction.fromPlayerId) || !playerIds.has(transaction.toPlayerId)) {
      return "Both transfer players must exist.";
    }
  }

  if (transaction.type === "debt_coverage") {
    if (!transaction.coveredPlayerId || !transaction.coveredByPlayerId) {
      return "Choose both the covered player and the player covering the debt.";
    }

    if (transaction.coveredPlayerId === transaction.coveredByPlayerId) {
      return "A player cannot cover their own debt.";
    }

    if (
      !playerIds.has(transaction.coveredPlayerId) ||
      !playerIds.has(transaction.coveredByPlayerId)
    ) {
      return "Both debt coverage players must exist.";
    }
  }

  if (
    transaction.coveredPlayerId !== undefined &&
    transaction.type !== "debt_coverage"
  ) {
    return "Covered-player details are only valid for debt coverage.";
  }

  if (
    transaction.coveredByPlayerId !== undefined &&
    transaction.type !== "bank_buy_in" &&
    transaction.type !== "debt_coverage"
  ) {
    return "Coverage details are only valid for covered buy-ins or debt coverage.";
  }

  if (
    transaction.type === "manual_bank_adjustment" &&
    transaction.bankDirection !== "incoming" &&
    transaction.bankDirection !== "outgoing"
  ) {
    return "Choose whether the chip adjustment is issued or returned.";
  }

  if (
    transaction.category !== undefined &&
    transaction.category !== "poker" &&
    transaction.category !== "food"
  ) {
    return "Choose a valid transaction category.";
  }

  if (transaction.chipCountBreakdown !== undefined) {
    if (transaction.type !== "bank_cash_out") {
      return "Chip count details are only valid for cash-outs.";
    }

    if (
      !Array.isArray(transaction.chipCountBreakdown) ||
      !transaction.chipCountBreakdown.every(isValidChipCountLine) ||
      new Set(transaction.chipCountBreakdown.map((line) => line.denominationId)).size !==
        transaction.chipCountBreakdown.length
    ) {
      return "Enter a valid chip count breakdown.";
    }

    const breakdownTotalCents = chipCountTotalCents(transaction.chipCountBreakdown);
    if (!Number.isSafeInteger(breakdownTotalCents)) {
      return "The chip count total is too large.";
    }

    if (breakdownTotalCents !== transaction.amountCents) {
      return "The chip count breakdown does not match the cash-out amount.";
    }

    if (transaction.chipCountBreakdown.length === 0 && transaction.amountCents !== 0) {
      return "An empty chip count can only record a zero cash-out.";
    }
  }

  if (transaction.correctsTransactionId !== undefined) {
    if (transaction.type !== "bank_cash_out" || !transaction.correctsTransactionId) {
      return "Only a cash-out can correct another cash-out.";
    }
    if (transaction.cashOutKind !== undefined && transaction.cashOutKind !== "final") {
      return "Only a final cash-out can correct another cash-out.";
    }
  }

  return null;
}

function isValidTableShape(value: unknown): value is TableShape {
  return value === "rectangle" || value === "oval" || value === "round";
}

const TRANSACTION_TYPES = new Set<TransactionType>([
  "bank_buy_in",
  "bank_cash_out",
  "player_transfer",
  "debt_coverage",
  "manual_bank_adjustment"
]);

function isValidSeatRail(value: unknown): value is SeatRail {
  return value === "top" || value === "right" || value === "bottom" || value === "left";
}

function isValidSeatPlacement(value: unknown): value is TableSeatPlacement {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<TableSeatPlacement>;
  return (
    typeof candidate.seatIndex === "number" &&
    Number.isInteger(candidate.seatIndex) &&
    candidate.seatIndex >= 0 &&
    isValidSeatRail(candidate.rail) &&
    typeof candidate.order === "number" &&
    Number.isInteger(candidate.order) &&
    candidate.order >= 0
  );
}

export function validatePersistedState(value: unknown): value is AnyPersistedGameState {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as {
    schemaVersion?: unknown;
    settings?: {
      currencyCode?: unknown;
      defaultBuyInCents?: unknown;
      gameName?: unknown;
      createdAt?: unknown;
      tableShape?: unknown;
      tableSeatPlacements?: unknown;
      tableSeatLayout?: unknown;
      tableIncludeCornerSeats?: unknown;
      chipDenominations?: unknown;
    };
    players?: unknown;
    transactions?: unknown;
    cashOutDrafts?: unknown;
  };
  const isLegacySettings =
    candidate.schemaVersion === 1 &&
    !!candidate.settings &&
    (candidate.settings.tableSeatLayout === undefined ||
      candidate.settings.tableSeatLayout === "top_bottom" ||
      candidate.settings.tableSeatLayout === "left_right" ||
      candidate.settings.tableSeatLayout === "rectangle" ||
      candidate.settings.tableSeatLayout === "round") &&
    (candidate.settings.tableIncludeCornerSeats === undefined ||
      typeof candidate.settings.tableIncludeCornerSeats === "boolean");
  const isV2Settings =
    candidate.schemaVersion === 2 &&
    isValidTableShape(candidate.settings?.tableShape) &&
    Array.isArray(candidate.settings?.tableSeatPlacements) &&
    candidate.settings.tableSeatPlacements.every(isValidSeatPlacement);
  const hasCurrentSettings =
    (candidate.schemaVersion === 3 ||
      candidate.schemaVersion === 4 ||
      candidate.schemaVersion === 5) &&
    isValidTableShape(candidate.settings?.tableShape) &&
    Array.isArray(candidate.settings?.tableSeatPlacements) &&
    candidate.settings.tableSeatPlacements.every(isValidSeatPlacement) &&
    Array.isArray(candidate.settings?.chipDenominations) &&
    candidate.settings.chipDenominations.every(isValidChipDenomination) &&
    new Set(candidate.settings.chipDenominations.map((item) => item.id)).size ===
      candidate.settings.chipDenominations.length &&
    new Set(
      candidate.settings.chipDenominations.map((item) => item.label.trim().toLowerCase())
    ).size === candidate.settings.chipDenominations.length &&
    new Set(
      candidate.settings.chipDenominations.map((item) => item.colorHex.toLowerCase())
    ).size === candidate.settings.chipDenominations.length;
  const persistedPlayerIds = new Set(
    Array.isArray(candidate.players) ? candidate.players.map((player) => player.id) : []
  );

  return (
    (candidate.schemaVersion === 1 ||
      candidate.schemaVersion === 2 ||
      candidate.schemaVersion === 3 ||
      candidate.schemaVersion === 4 ||
      candidate.schemaVersion === 5) &&
    !!candidate.settings &&
    Array.isArray(candidate.players) &&
    Array.isArray(candidate.transactions) &&
    candidate.settings.currencyCode === "USD" &&
    typeof candidate.settings.defaultBuyInCents === "number" &&
    typeof candidate.settings.gameName === "string" &&
    typeof candidate.settings.createdAt === "string" &&
    (isLegacySettings || isV2Settings || hasCurrentSettings) &&
    ((candidate.schemaVersion !== 3 &&
      candidate.schemaVersion !== 4 &&
      candidate.schemaVersion !== 5) ||
      (Array.isArray(candidate.cashOutDrafts) &&
        candidate.cashOutDrafts.every(isValidCashOutDraft) &&
        candidate.cashOutDrafts.every((draft) => persistedPlayerIds.has(draft.playerId)) &&
        new Set(candidate.cashOutDrafts.map((draft) => draft.playerId)).size ===
          candidate.cashOutDrafts.length)) &&
    candidate.players.every(
      (player) =>
        typeof player.id === "string" &&
        typeof player.name === "string" &&
        typeof player.seatIndex === "number" &&
        typeof player.isActive === "boolean"
    ) &&
    candidate.transactions.every((transaction) => {
      const basic =
        typeof transaction.id === "string" &&
        typeof transaction.type === "string" &&
        TRANSACTION_TYPES.has(transaction.type as TransactionType) &&
        (transaction.type !== "debt_coverage" ||
          candidate.schemaVersion === 4 ||
          candidate.schemaVersion === 5) &&
        typeof transaction.createdAt === "string" &&
        typeof transaction.amountCents === "number" &&
        Number.isSafeInteger(transaction.amountCents) &&
        (transaction.category === undefined ||
          transaction.category === "poker" ||
          transaction.category === "food");
      if (!basic) return false;
      if (
        candidate.schemaVersion === 5 &&
        transaction.type === "bank_cash_out" &&
        (transaction.cashOutKind !== "partial" && transaction.cashOutKind !== "final")
      ) {
        return false;
      }

      const structuralError = validateTransaction(
        transaction as Transaction,
        candidate.players as Player[]
      );
      if (structuralError) return false;
      if (
        transaction.chipCountBreakdown !== undefined &&
        (!Array.isArray(transaction.chipCountBreakdown) ||
          transaction.type !== "bank_cash_out" ||
          !transaction.chipCountBreakdown.every(isValidChipCountLine) ||
          new Set(
            transaction.chipCountBreakdown.map(
              (line: ChipCountLine) => line.denominationId
            )
          ).size !==
            transaction.chipCountBreakdown.length ||
          chipCountTotalCents(transaction.chipCountBreakdown) !== transaction.amountCents)
      ) {
        return false;
      }
      if (
        transaction.chipCountBreakdown !== undefined &&
        !Number.isSafeInteger(chipCountTotalCents(transaction.chipCountBreakdown))
      ) {
        return false;
      }
      return (
        transaction.correctsTransactionId === undefined ||
        (transaction.type === "bank_cash_out" &&
          typeof transaction.correctsTransactionId === "string" &&
          transaction.correctsTransactionId.length > 0)
      );
    })
  );
}
