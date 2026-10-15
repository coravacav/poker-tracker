// Shared audit-event construction: describes each accepted host action in
// locale-independent text and retains a bounded event log per room.
import { formatPlainCurrency } from "../../src/domain/money";
import type { GameState, SettlementPin, Transaction } from "../../src/domain/pokerTypes";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

const MAX_SHARED_AUDIT_EVENTS = 500;

export type AuditEventKind = "transaction" | "cash_out" | "correction" | "game";

type AuditEventDraft = {
  eventId: string;
  version: number;
  actionType: string;
  kind: AuditEventKind;
  summary: string;
  transactionIds: string[];
  playerIds: string[];
  actorLabel: string;
  createdAt: number;
  notify: boolean;
};

function isPrivateAuditAction(type: string): boolean {
  return [
    "save_cash_out_draft",
    "clear_cash_out_draft",
    "start_cash_out_correction"
  ].includes(type);
}

/** Audit text is shared by everyone in the room, so it avoids locale-dependent formatting. */
function formatAmount(amountCents: number, state: GameState): string {
  return formatPlainCurrency(amountCents, state.settings.currencyCode);
}

function playerName(state: GameState, playerId: string | undefined): string {
  if (!playerId) return "Chip Pool";
  return state.players.find((player) => player.id === playerId)?.name ?? "Unknown player";
}

function transactionPlayerIds(transaction: Transaction): string[] {
  return [
    transaction.fromPlayerId,
    transaction.toPlayerId,
    transaction.coveredByPlayerId,
    transaction.coveredPlayerId
  ].filter((playerId): playerId is string => typeof playerId === "string");
}

function describeTransaction(transaction: Transaction, state: GameState): string {
  const amount = formatAmount(transaction.amountCents, state);

  if (transaction.type === "bank_buy_in") {
    const recipient = playerName(state, transaction.toPlayerId);
    if (transaction.coveredByPlayerId) {
      return `${playerName(state, transaction.coveredByPlayerId)} covered ${recipient}'s buy-in of ${amount}`;
    }
    return `${recipient} bought in for ${amount}`;
  }

  if (transaction.type === "bank_cash_out") {
    const verb = transaction.cashOutKind === "final" ? "cashed out" : "partially cashed out";
    return `${playerName(state, transaction.fromPlayerId)} ${verb} ${amount}`;
  }

  if (transaction.type === "player_gave" || transaction.type === "player_transfer") {
    return `${playerName(state, transaction.fromPlayerId)} gave ${playerName(state, transaction.toPlayerId)} ${amount}`;
  }

  if (transaction.type === "player_owes") {
    return `${playerName(state, transaction.fromPlayerId)} owes ${playerName(state, transaction.toPlayerId)} ${amount}`;
  }

  if (transaction.type === "debt_coverage") {
    return `${playerName(state, transaction.coveredByPlayerId)} covered ${playerName(state, transaction.coveredPlayerId)}'s debt of ${amount}`;
  }

  return `Chip pool ${transaction.bankDirection === "outgoing" ? "decreased" : "increased"} by ${amount}`;
}

function changedTransactions(before: GameState, after: GameState): Transaction[] {
  const beforeById = new Map(before.transactions.map((transaction) => [transaction.id, transaction]));
  const afterById = new Map(after.transactions.map((transaction) => [transaction.id, transaction]));
  const ids = new Set([...beforeById.keys(), ...afterById.keys()]);

  return [...ids]
    .filter((id) => JSON.stringify(beforeById.get(id)) !== JSON.stringify(afterById.get(id)))
    .map((id) => afterById.get(id) ?? beforeById.get(id))
    .filter((transaction): transaction is Transaction => transaction !== undefined);
}

function actionType(action: unknown): string {
  if (!action || typeof action !== "object" || typeof (action as { type?: unknown }).type !== "string") {
    return "unknown";
  }
  return (action as { type: string }).type;
}

function settlementPinById(state: GameState, pinId: unknown): SettlementPin | undefined {
  return typeof pinId === "string"
    ? state.settlementPins?.find((pin) => pin.id === pinId)
    : undefined;
}

function describeSettlementPin(pin: SettlementPin | undefined, state: GameState): string {
  if (!pin) return "a settlement payment";
  return `${playerName(state, pin.fromPlayerId)} pays ${playerName(state, pin.toPlayerId)} ${formatAmount(pin.amountCents, state)}`;
}

function actionPlayerIds(action: unknown): string[] {
  if (!action || typeof action !== "object") return [];
  const candidate = action as Record<string, unknown>;
  const pin = candidate.pin && typeof candidate.pin === "object"
    ? candidate.pin as Record<string, unknown>
    : {};
  return [
    pin.fromPlayerId,
    pin.toPlayerId,
    candidate.playerId,
    candidate.fromPlayerId,
    candidate.toPlayerId,
    candidate.coveredPlayerId,
    candidate.coveredByPlayerId
  ].filter((playerId): playerId is string => typeof playerId === "string");
}

function auditSummary(
  action: unknown,
  before: GameState,
  after: GameState,
  changed: Transaction[]
): string {
  const type = actionType(action);
  const added = changed.filter(
    (transaction) => !before.transactions.some((candidate) => candidate.id === transaction.id)
  );
  const firstAdded = added[0];

  if (type === "add_transaction" && firstAdded) return describeTransaction(firstAdded, after);
  if (type === "add_transactions") {
    return added.length === 1
      ? describeTransaction(firstAdded!, after)
      : `Added ${added.length} transactions`;
  }
  if (type === "record_cash_out" && firstAdded) return describeTransaction(firstAdded, after);
  if (type === "replace_cash_out" && firstAdded) {
    return `Corrected ${describeTransaction(firstAdded, after)}`;
  }
  if (type === "flip_transaction" && firstAdded) {
    return `Reversed ${describeTransaction(firstAdded, after)}`;
  }
  if (type === "void_transaction" && changed[0]) {
    return `Voided ${describeTransaction(changed[0], after)}`;
  }
  if (type === "undo_recent_transaction" && changed[0]) {
    return `Undid ${describeTransaction(changed[0], before)}`;
  }

  const candidate = action && typeof action === "object" ? action as Record<string, unknown> : {};
  const firstPlayerId = typeof candidate.playerId === "string" ? candidate.playerId : undefined;
  const firstPlayer = playerName(after, firstPlayerId);

  switch (type) {
    case "set_game_name":
      return `Renamed the game to ${typeof candidate.name === "string" ? candidate.name.trim() || "Poker Night" : "Poker Night"}`;
    case "set_default_buy_in":
      return `Changed the default buy-in to ${formatAmount(typeof candidate.amountCents === "number" ? candidate.amountCents : 0, after)}`;
    case "set_currency":
      return `Changed the currency to ${after.settings.currencyCode}`;
    case "set_chip_denominations":
      return "Updated the chip value key";
    case "set_table_shape":
      return `Changed the table shape to ${typeof candidate.shape === "string" ? candidate.shape : "custom"}`;
    case "move_table_seat":
      return "Updated the table layout";
    case "move_player_to_seat":
      return `${firstPlayer} moved to a different seat`;
    case "set_player_count":
      return `Changed the player count to ${typeof candidate.count === "number" ? candidate.count : "a new value"}`;
    case "add_player":
      return `Added ${firstPlayer}`;
    case "replace_active_players":
      return `Updated the player list (${after.players.filter((player) => player.isActive).length} active)`;
    case "rename_player":
      return `Renamed ${firstPlayer}`;
    case "set_player_venmo_handle":
      return typeof candidate.venmoHandle === "string"
        ? `Set the Venmo username for ${firstPlayer}`
        : `Removed the Venmo username for ${firstPlayer}`;
    case "archive_player":
      return `Archived ${firstPlayer}`;
    case "reorder_players":
      return "Reordered the players";
    case "save_cash_out_draft":
      return `Updated the cash-out draft for ${firstPlayer}`;
    case "clear_cash_out_draft":
      return `Cleared the cash-out draft for ${firstPlayer}`;
    case "start_cash_out_correction":
      return `Started a cash-out correction for ${firstPlayer}`;
    case "pin_settlement_payment":
    case "set_settlement_pin_status": {
      const pinId = type === "pin_settlement_payment"
        ? (candidate.pin as { id?: unknown } | undefined)?.id
        : candidate.pinId;
      const pin = settlementPinById(after, pinId);
      return pin?.status === "paid"
        ? `Marked ${describeSettlementPin(pin, after)} as paid`
        : `Locked ${describeSettlementPin(pin, after)}`;
    }
    case "unpin_settlement_payment":
      return `Unpinned ${describeSettlementPin(settlementPinById(before, candidate.pinId), before)}`;
    case "clear_settlement_pins":
      return "Cleared the settlement payment marks";
    default:
      return `Updated the shared game (${type})`;
  }
}

function auditKind(type: string, changed: Transaction[]): AuditEventKind {
  if (["flip_transaction", "void_transaction", "undo_recent_transaction"].includes(type)) {
    return "correction";
  }
  if (["record_cash_out", "replace_cash_out", "save_cash_out_draft", "clear_cash_out_draft", "start_cash_out_correction"].includes(type)) {
    return "cash_out";
  }
  if (changed.length > 0 || ["add_transaction", "add_transactions"].includes(type)) {
    return "transaction";
  }
  return "game";
}

export function buildAuditEvent(
  before: GameState,
  after: GameState,
  action: unknown,
  version: number,
  createdAt: number
): AuditEventDraft | null {
  const type = actionType(action);
  if (isPrivateAuditAction(type)) return null;
  const changed = changedTransactions(before, after);
  const kind = auditKind(type, changed);
  const transactionIds = changed.map((transaction) => transaction.id);
  const playerIds = [
    ...actionPlayerIds(action),
    ...changed.flatMap(transactionPlayerIds)
  ].filter((playerId, index, all) => all.indexOf(playerId) === index);

  return {
    eventId: `event_${crypto.randomUUID()}`,
    version,
    actionType: type,
    kind,
    summary: auditSummary(action, before, after, changed),
    transactionIds,
    playerIds,
    actorLabel: "Host",
    createdAt,
    notify: kind !== "game"
  };
}


export async function appendAuditEvent(ctx: MutationCtx, roomId: Doc<"rooms">["_id"], event: AuditEventDraft) {
  await ctx.db.insert("roomAuditEvents", { roomId, ...event });
  const retained = await ctx.db
    .query("roomAuditEvents")
    .withIndex("by_room_id_and_created_at", (index) => index.eq("roomId", roomId))
    .order("desc")
    .take(MAX_SHARED_AUDIT_EVENTS + 1);
  for (const staleEvent of retained.slice(MAX_SHARED_AUDIT_EVENTS)) {
    await ctx.db.delete(staleEvent._id);
  }
}
