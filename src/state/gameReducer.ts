import type { GameState } from "../domain/pokerTypes";
import type { GameAction } from "./gameActions";
import { migratePersistedState } from "./persistence";
import { reduceCashOutAction } from "./reducers/cashOutReducer";
import { reducePlayerAction } from "./reducers/playersReducer";
import { reconcileSeatIndexes } from "./reducers/seatIndexes";
import { reduceSettingsAction } from "./reducers/settingsReducer";
import { reduceSettlementPinAction } from "./reducers/settlementPinsReducer";
import { reduceTransactionAction } from "./reducers/transactionsReducer";
import { createDefaultGameState } from "./seedGame";

export type { GameAction } from "./gameActions";

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case "set_game_name":
    case "set_default_buy_in":
    case "set_currency":
    case "set_chip_denominations":
    case "set_table_shape":
    case "move_table_seat":
      return reduceSettingsAction(state, action);

    case "move_player_to_seat":
    case "set_player_count":
    case "add_player":
    case "replace_active_players":
    case "rename_player":
    case "set_player_venmo_handle":
    case "archive_player":
    case "reorder_players":
      return reducePlayerAction(state, action);

    case "add_transaction":
    case "add_transactions":
    case "flip_transaction":
    case "void_transaction":
    case "undo_recent_transaction":
      return reduceTransactionAction(state, action);

    case "save_cash_out_draft":
    case "clear_cash_out_draft":
    case "start_cash_out_correction":
    case "record_cash_out":
    case "replace_cash_out":
      return reduceCashOutAction(state, action);

    case "pin_settlement_payment":
    case "set_settlement_pin_status":
    case "unpin_settlement_payment":
    case "clear_settlement_pins":
      return reduceSettlementPinAction(state, action);

    case "replace_state_from_import":
      return reconcileSeatIndexes(migratePersistedState(action.state));

    case "reset_game": {
      // The next game is most likely the same game again: same currency, chip set,
      // buy-in, name, and table. Players, seats, and the ledger start fresh.
      const next = createDefaultGameState(state.settings.currencyCode);
      return {
        ...next,
        settings: {
          ...next.settings,
          gameName: state.settings.gameName,
          defaultBuyInCents: state.settings.defaultBuyInCents,
          tableShape: state.settings.tableShape,
          chipDenominations: state.settings.chipDenominations.map((denomination) => ({ ...denomination }))
        }
      };
    }

    default:
      return state;
  }
}
