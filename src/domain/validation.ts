import type {
  AnyPersistedGameState,
  Player,
  SeatRail,
  TableSeatPlacement,
  TableShape,
  Transaction
} from "./pokerTypes";

export function validateTransaction(
  transaction: Transaction,
  players: Player[]
): string | null {
  const playerIds = new Set(players.map((player) => player.id));

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

  if (transaction.type === "bank_cash_out" && !transaction.fromPlayerId) {
    return "Choose the player returning chips.";
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

  return null;
}

function isValidTableShape(value: unknown): value is TableShape {
  return value === "rectangle" || value === "oval" || value === "round";
}

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
    };
    players?: unknown;
    transactions?: unknown;
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
  const isCurrentSettings =
    candidate.schemaVersion === 2 &&
    isValidTableShape(candidate.settings?.tableShape) &&
    Array.isArray(candidate.settings?.tableSeatPlacements) &&
    candidate.settings.tableSeatPlacements.every(isValidSeatPlacement);

  return (
    (candidate.schemaVersion === 1 || candidate.schemaVersion === 2) &&
    !!candidate.settings &&
    Array.isArray(candidate.players) &&
    Array.isArray(candidate.transactions) &&
    candidate.settings.currencyCode === "USD" &&
    typeof candidate.settings.defaultBuyInCents === "number" &&
    typeof candidate.settings.gameName === "string" &&
    typeof candidate.settings.createdAt === "string" &&
    (isLegacySettings || isCurrentSettings) &&
    candidate.players.every(
      (player) =>
        typeof player.id === "string" &&
        typeof player.name === "string" &&
        typeof player.seatIndex === "number" &&
        typeof player.isActive === "boolean"
    ) &&
    candidate.transactions.every(
      (transaction) =>
        typeof transaction.id === "string" &&
        typeof transaction.type === "string" &&
        typeof transaction.createdAt === "string" &&
        typeof transaction.amountCents === "number" &&
        (transaction.category === undefined ||
          transaction.category === "poker" ||
          transaction.category === "food")
    )
  );
}
