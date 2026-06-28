import { Plus, ShieldCheck, ShieldOff } from "lucide-react";
import { useEffect, useState } from "react";
import type { Dispatch } from "react";
import { centsToInputValue, parseMoneyToCents } from "../domain/money";
import type { GameState, TableSeatLayout } from "../domain/pokerTypes";
import type { GameAction } from "../state/gameReducer";
import { ExportImportControls } from "./ExportImportControls";

type TableSetupPanelProps = {
  activePlayerCount: number;
  dispatch: Dispatch<GameAction>;
  minimumPlayerCount: number;
  readOnly: boolean;
  setReadOnly: (value: boolean) => void;
  state: GameState;
};

export function TableSetupPanel({
  activePlayerCount,
  dispatch,
  minimumPlayerCount,
  readOnly,
  setReadOnly,
  state
}: TableSetupPanelProps) {
  const [buyInInput, setBuyInInput] = useState(
    centsToInputValue(state.settings.defaultBuyInCents)
  );
  const [buyInError, setBuyInError] = useState<string | null>(null);

  useEffect(() => {
    setBuyInInput(centsToInputValue(state.settings.defaultBuyInCents));
  }, [state.settings.defaultBuyInCents]);

  function commitBuyIn() {
    const cents = parseMoneyToCents(buyInInput);
    if (!cents || cents <= 0) {
      setBuyInError("Enter a positive buy-in.");
      setBuyInInput(centsToInputValue(state.settings.defaultBuyInCents));
      return;
    }

    dispatch({ type: "set_default_buy_in", amountCents: cents });
    setBuyInError(null);
  }

  return (
    <div className="setup-panel" aria-label="Game setup">
      <label className="compact-field">
        <span>Game</span>
        <input
          type="text"
          value={state.settings.gameName}
          onChange={(event) =>
            dispatch({ type: "set_game_name", name: event.currentTarget.value })
          }
        />
      </label>

      <label className="compact-field money-field">
        <span>Buy-in</span>
        <input
          inputMode="decimal"
          type="text"
          value={buyInInput}
          onBlur={commitBuyIn}
          onChange={(event) => setBuyInInput(event.currentTarget.value)}
        />
      </label>

      <label className="compact-field count-field">
        <span>Players</span>
        <input
          min={1}
          max={12}
          type="number"
          value={activePlayerCount}
          onChange={(event) => {
            const requestedCount = Number.parseInt(event.currentTarget.value, 10) || 1;

            dispatch({
              type: "set_player_count",
              count: Math.max(minimumPlayerCount, requestedCount)
            });
          }}
        />
      </label>

      <label className="compact-field layout-field">
        <span>Layout</span>
        <select
          value={state.settings.tableSeatLayout ?? "top_bottom"}
          onChange={(event) =>
            dispatch({
              type: "set_table_seat_layout",
              layout: event.currentTarget.value as TableSeatLayout
            })
          }
        >
          <option value="top_bottom">Oval - top/bottom</option>
          <option value="left_right">Oval - left/right</option>
          <option value="rectangle">Rectangle</option>
          <option value="round">Round</option>
        </select>
      </label>

      {state.settings.tableSeatLayout === "rectangle" ? (
        <label className="compact-toggle">
          <input
            type="checkbox"
            checked={state.settings.tableIncludeCornerSeats ?? true}
            onChange={(event) =>
              dispatch({
                type: "set_table_include_corner_seats",
                includeCornerSeats: event.currentTarget.checked
              })
            }
          />
          <span>Corners</span>
        </label>
      ) : null}

      <button
        className="text-button"
        type="button"
        disabled={readOnly}
        onClick={() => dispatch({ type: "add_player" })}
      >
        <Plus size={16} />
        Player
      </button>

      <button
        className="text-button"
        type="button"
        onClick={() => setReadOnly(!readOnly)}
        title="Toggle read-only audit mode"
      >
        {readOnly ? <ShieldCheck size={16} /> : <ShieldOff size={16} />}
        {readOnly ? "Read-only" : "Editable"}
      </button>

      <ExportImportControls dispatch={dispatch} state={state} />
      {buyInError ? <span className="inline-error">{buyInError}</span> : null}
      {minimumPlayerCount > 1 ? (
        <span className="inline-hint">
          Minimum {minimumPlayerCount} players because they have transactions.
        </span>
      ) : null}
    </div>
  );
}
