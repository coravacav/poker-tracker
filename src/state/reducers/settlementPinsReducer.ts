import type { GameState, SettlementPin } from "../../domain/pokerTypes";
import { MAX_SETTLEMENT_PINS, sanitizeSettlementPins } from "../../domain/settlement";
import type { SettlementPinAction } from "../gameActions";

/** Stores pins without an empty array, so pin-free games keep their old shape. */
function withSettlementPins(state: GameState, pins: SettlementPin[]): GameState {
  const { settlementPins: _settlementPins, ...rest } = state;
  return pins.length > 0 ? { ...rest, settlementPins: pins } : rest;
}

export function reduceSettlementPinAction(state: GameState, action: SettlementPinAction): GameState {
  switch (action.type) {
    case "pin_settlement_payment": {
      const pins = state.settlementPins ?? [];
      const [pin] = sanitizeSettlementPins([action.pin], state.players);
      if (!pin || pins.length >= MAX_SETTLEMENT_PINS || pins.some((existing) => existing.id === pin.id)) {
        return state;
      }
      return withSettlementPins(state, [...pins, pin]);
    }

    case "set_settlement_pin_status": {
      const pins = state.settlementPins ?? [];
      const target = pins.find((pin) => pin.id === action.pinId);
      if (!target || target.status === action.status || (action.status !== "locked" && action.status !== "paid")) {
        return state;
      }
      return withSettlementPins(
        state,
        pins.map((pin) => (pin.id === action.pinId ? { ...pin, status: action.status } : pin))
      );
    }

    case "unpin_settlement_payment": {
      const pins = state.settlementPins ?? [];
      if (!pins.some((pin) => pin.id === action.pinId)) return state;
      return withSettlementPins(state, pins.filter((pin) => pin.id !== action.pinId));
    }

    case "clear_settlement_pins":
      return state.settlementPins === undefined ? state : withSettlementPins(state, []);

    default:
      return state;
  }
}
