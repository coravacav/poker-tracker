import { mergeChipCountLines, snapshotNonzeroChipCountLines } from "../../domain/chipCounts";
import { moveSeatPlacement } from "../../domain/tableLayout";
import type { GameState } from "../../domain/pokerTypes";
import { isSupportedCurrencyCode } from "../../domain/money";
import { schemaVersionForCurrency } from "../../domain/validation";
import type { SettingsAction } from "../gameActions";
import { reconcileSeatIndexes } from "./seatIndexes";

export function reduceSettingsAction(state: GameState, action: SettingsAction): GameState {
  switch (action.type) {
    case "set_game_name":
      return {
        ...state,
        settings: {
          ...state.settings,
          gameName: action.name
        }
      };

    case "set_default_buy_in":
      return {
        ...state,
        settings: {
          ...state.settings,
          defaultBuyInCents: action.amountCents
        }
      };

    case "set_currency":
      if (
        !isSupportedCurrencyCode(action.currencyCode) ||
        action.currencyCode === state.settings.currencyCode
      ) {
        return state;
      }
      return {
        ...state,
        schemaVersion: schemaVersionForCurrency(action.currencyCode),
        settings: {
          ...state.settings,
          currencyCode: action.currencyCode
        }
      };

    case "set_chip_denominations":
      return {
        ...state,
        settings: {
          ...state.settings,
          chipDenominations: action.denominations.map((denomination) => ({ ...denomination }))
        },
        cashOutDrafts: state.cashOutDrafts.map((draft) => ({
          ...draft,
          lines: snapshotNonzeroChipCountLines(
            mergeChipCountLines(action.denominations, draft.lines)
          )
        }))
      };

    case "set_table_shape":
      return reconcileSeatIndexes({
        ...state,
        settings: {
          ...state.settings,
          tableShape: action.shape
        }
      });

    case "move_table_seat":
      return reconcileSeatIndexes({
        ...state,
        settings: {
          ...state.settings,
          tableSeatPlacements: moveSeatPlacement(
            state.settings.tableSeatPlacements,
            action.seatIndex,
            action.rail,
            action.order
          )
        }
      });

    default:
      return state;
  }
}
