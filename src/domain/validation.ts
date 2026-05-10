import type {
  GameState,
  PersistedGameState,
  Player,
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
    return "Choose the player receiving the buy-in.";
  }

  if (
    transaction.type === "bank_buy_in" &&
    transaction.toPlayerId &&
    !playerIds.has(transaction.toPlayerId)
  ) {
    return "The buy-in player does not exist.";
  }

  if (transaction.type === "bank_cash_out" && !transaction.fromPlayerId) {
    return "Choose the player cashing out.";
  }

  if (
    transaction.type === "bank_cash_out" &&
    transaction.fromPlayerId &&
    !playerIds.has(transaction.fromPlayerId)
  ) {
    return "The cash-out player does not exist.";
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
    return "Choose whether the bank adjustment is incoming or outgoing.";
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

export function validatePersistedState(value: unknown): value is PersistedGameState {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<GameState>;
  return (
    candidate.schemaVersion === 1 &&
    !!candidate.settings &&
    Array.isArray(candidate.players) &&
    Array.isArray(candidate.transactions) &&
    candidate.settings.currencyCode === "USD" &&
    typeof candidate.settings.defaultBuyInCents === "number" &&
    (candidate.settings.tableSeatLayout === undefined ||
      candidate.settings.tableSeatLayout === "top_bottom" ||
      candidate.settings.tableSeatLayout === "left_right") &&
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
