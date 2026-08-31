import { ShieldCheck, ShieldOff } from "lucide-react";
import { useEffect, useState } from "react";
import type { Dispatch } from "react";
import { centsToInputValue, parseMoneyToCents } from "../domain/money";
import type { GameState } from "../domain/pokerTypes";
import type { GameAction } from "../state/gameReducer";
import { ExportImportControls } from "./ExportImportControls";

type TableSetupPanelProps = {
  dispatch: Dispatch<GameAction>;
  readOnly: boolean;
  setReadOnly: (value: boolean) => void;
  state: GameState;
};

const quickBuyInAmountsCents = [500, 1000, 2000, 5000, 10000] as const;

export function TableSetupPanel({
  dispatch,
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

  function setBuyIn(cents: number) {
    setBuyInInput(centsToInputValue(cents));
    dispatch({ type: "set_default_buy_in", amountCents: cents });
    setBuyInError(null);
  }

  function commitBuyIn() {
    const cents = parseMoneyToCents(buyInInput);
    if (!cents || cents <= 0) {
      setBuyInError("Enter a positive buy-in.");
      setBuyInInput(centsToInputValue(state.settings.defaultBuyInCents));
      return;
    }

    setBuyIn(cents);
  }

  return (
    <section className="panel setup-settings-panel" aria-label="Game setup">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Before play</p>
          <h2>Game Setup</h2>
        </div>
      </div>

      <div className="setup-panel">
        <label className="compact-field">
          <span>Game</span>
          <input
            disabled={readOnly}
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
            disabled={readOnly}
            inputMode="decimal"
            type="text"
            value={buyInInput}
            onBlur={commitBuyIn}
            onChange={(event) => setBuyInInput(event.currentTarget.value)}
          />
        </label>

        <div className="setup-buy-in-presets" role="group" aria-label="Common buy-in amounts">
          <span>Quick buy-in</span>
          <div>
            {quickBuyInAmountsCents.map((amountCents) => {
              const amountDollars = amountCents / 100;

              return (
                <button
                  aria-label={`Set buy-in to $${amountDollars}`}
                  aria-pressed={state.settings.defaultBuyInCents === amountCents}
                  key={amountCents}
                  disabled={readOnly}
                  type="button"
                  onClick={() => setBuyIn(amountCents)}
                >
                  ${amountDollars}
                </button>
              );
            })}
          </div>
        </div>

        <button
          className="text-button"
          type="button"
          onClick={() => setReadOnly(!readOnly)}
          title="Toggle read-only audit mode"
        >
          {readOnly ? <ShieldCheck size={16} /> : <ShieldOff size={16} />}
          {readOnly ? "Read-only" : "Editable"}
        </button>

        <ExportImportControls dispatch={dispatch} readOnly={readOnly} state={state} />
        {buyInError ? <span className="inline-error">{buyInError}</span> : null}
      </div>
    </section>
  );
}
