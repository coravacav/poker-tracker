import type {
  AnyPersistedGameState,
  CashOutDraft,
  ChipDenomination,
  GameState,
  PlayerId,
  SeatRail,
  SettlementPin,
  SettlementPinStatus,
  Transaction,
  TransactionId
} from "../domain/pokerTypes";
import type { RecentTransactionAction } from "../domain/recentTransactionAction";
import type { CurrencyCode } from "../domain/money";

export type GameAction =
  | { type: "set_game_name"; name: string }
  | { type: "set_default_buy_in"; amountCents: number }
  /**
   * Relabels every amount in the game; nothing is converted. Unsupported codes
   * are ignored. Also moves the save between schema 7 (USD) and 8 (others).
   */
  | { type: "set_currency"; currencyCode: CurrencyCode }
  | { type: "set_chip_denominations"; denominations: ChipDenomination[] }
  | { type: "set_table_shape"; shape: GameState["settings"]["tableShape"] }
  | { type: "move_table_seat"; seatIndex: number; rail: SeatRail; order: number }
  | { type: "move_player_to_seat"; playerId: PlayerId; seatIndex: number }
  | { type: "set_player_count"; count: number }
  | { type: "add_player"; name?: string; personId?: string }
  | {
      type: "replace_active_players";
      names: string[];
      /** Parallel to `names`; see rename_player for how a missing entry is treated. */
      personIds?: Array<string | null | undefined>;
      /** Parallel to `names`; see rename_player's venmoHandle. */
      venmoHandles?: Array<string | null | undefined>;
    }
  | {
      type: "rename_player";
      playerId: PlayerId;
      name: string;
      /**
       * Person link for the new name. A string links, null unlinks. When omitted
       * (older clients), the link is kept only if the name is unchanged apart from case.
       */
      personId?: string | null;
      /**
       * Venmo username to go with the new link (e.g. the linked person's). A
       * string sets it, null clears it, omitted keeps the current one.
       */
      venmoHandle?: string | null;
    }
  /** Sets (string) or clears (null) a player's Venmo username for settlement pay links. */
  | { type: "set_player_venmo_handle"; playerId: PlayerId; venmoHandle: string | null }
  | { type: "archive_player"; playerId: PlayerId }
  | { type: "reorder_players"; orderedPlayerIds: PlayerId[] }
  | { type: "add_transaction"; transaction: Transaction }
  | { type: "add_transactions"; transactions: Transaction[] }
  | { type: "save_cash_out_draft"; draft: CashOutDraft }
  | { type: "clear_cash_out_draft"; playerId: PlayerId }
  | { type: "start_cash_out_correction"; playerId: PlayerId; transactionId: TransactionId }
  | { type: "record_cash_out"; transaction: Transaction }
  | {
      type: "replace_cash_out";
      originalTransactionId: TransactionId;
      replacement: Transaction;
    }
  | { type: "flip_transaction"; transactionId: TransactionId }
  | { type: "void_transaction"; transactionId: TransactionId; reason: string }
  | {
      type: "undo_recent_transaction";
      action: RecentTransactionAction;
      requestedAt: string;
    }
  /** Fixes a settlement payment in place; the rest of the plan is computed around it. */
  | { type: "pin_settlement_payment"; pin: SettlementPin }
  | { type: "set_settlement_pin_status"; pinId: string; status: SettlementPinStatus }
  | { type: "unpin_settlement_payment"; pinId: string }
  | { type: "clear_settlement_pins" }
  | { type: "replace_state_from_import"; state: AnyPersistedGameState }
  | { type: "reset_game" };

export type SettingsAction = Extract<
  GameAction,
  {
    type:
      | "set_game_name"
      | "set_default_buy_in"
      | "set_currency"
      | "set_chip_denominations"
      | "set_table_shape"
      | "move_table_seat";
  }
>;

export type PlayerAction = Extract<
  GameAction,
  {
    type:
      | "move_player_to_seat"
      | "set_player_count"
      | "add_player"
      | "replace_active_players"
      | "rename_player"
      | "set_player_venmo_handle"
      | "archive_player"
      | "reorder_players";
  }
>;

export type TransactionAction = Extract<
  GameAction,
  {
    type:
      | "add_transaction"
      | "add_transactions"
      | "flip_transaction"
      | "void_transaction"
      | "undo_recent_transaction";
  }
>;

export type CashOutAction = Extract<
  GameAction,
  {
    type:
      | "save_cash_out_draft"
      | "clear_cash_out_draft"
      | "start_cash_out_correction"
      | "record_cash_out"
      | "replace_cash_out";
  }
>;

export type SettlementPinAction = Extract<
  GameAction,
  {
    type:
      | "pin_settlement_payment"
      | "set_settlement_pin_status"
      | "unpin_settlement_payment"
      | "clear_settlement_pins";
  }
>;
