import { Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { Dispatch } from "react";
import { centsToInputValue, parseMoneyToCents } from "../domain/money";
import type { ChipDenomination } from "../domain/pokerTypes";
import type { GameAction } from "../state/gameReducer";
import { createId } from "../state/seedGame";

type EditableDenomination = Omit<ChipDenomination, "valueCents"> & {
  valueInput: string;
};

type ChipDenominationPanelProps = {
  denominations: ChipDenomination[];
  dispatch: Dispatch<GameAction>;
  readOnly: boolean;
};

function toEditable(denomination: ChipDenomination): EditableDenomination {
  return {
    id: denomination.id,
    label: denomination.label,
    colorHex: denomination.colorHex,
    valueInput: centsToInputValue(denomination.valueCents)
  };
}

export function ChipDenominationPanel({
  denominations,
  dispatch,
  readOnly
}: ChipDenominationPanelProps) {
  const [rows, setRows] = useState(() => denominations.map(toEditable));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setRows(denominations.map(toEditable));
  }, [denominations]);

  function updateRow(id: string, changes: Partial<EditableDenomination>) {
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, ...changes } : row))
    );
    setSaved(false);
  }

  function saveKey() {
    const parsed: ChipDenomination[] = [];
    for (const row of rows) {
      const label = row.label.trim();
      const valueCents = parseMoneyToCents(row.valueInput);
      if (!label) {
        setError("Give every chip color a name.");
        return;
      }
      if (!/^#[0-9a-f]{6}$/i.test(row.colorHex)) {
        setError(`Choose a valid color for ${label}.`);
        return;
      }
      if (!valueCents || valueCents <= 0) {
        setError(`Enter a positive value for ${label}.`);
        return;
      }
      parsed.push({ id: row.id, label, colorHex: row.colorHex, valueCents });
    }

    const normalizedLabels = parsed.map((item) => item.label.toLocaleLowerCase());
    const normalizedColors = parsed.map((item) => item.colorHex.toLocaleLowerCase());
    if (new Set(normalizedLabels).size !== normalizedLabels.length) {
      setError("Chip color names must be unique.");
      return;
    }
    if (new Set(normalizedColors).size !== normalizedColors.length) {
      setError("Chip colors must be unique.");
      return;
    }

    dispatch({ type: "set_chip_denominations", denominations: parsed });
    setRows(parsed.map(toEditable));
    setError(null);
    setSaved(true);
  }

  return (
    <section className="panel chip-denomination-panel" aria-label="Chip value key">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Chip counting</p>
          <h2>Chip Value Key</h2>
        </div>
        <button
          className="text-button"
          type="button"
          disabled={readOnly}
          onClick={() => {
            setRows((current) => [
              ...current,
              {
                id: createId("chip"),
                label: "",
                colorHex: "#ffffff",
                valueInput: ""
              }
            ]);
            setSaved(false);
          }}
        >
          <Plus size={16} />
          Add chip
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="muted chip-key-empty">
          No chip colors configured. Add the colors in this set before cashing out.
        </p>
      ) : (
        <div className="chip-key-rows">
          {rows.map((row) => (
            <div className="chip-key-row" key={row.id}>
              <span
                className="chip-swatch chip-swatch-large"
                style={{ backgroundColor: row.colorHex }}
                aria-hidden="true"
              />
              <label>
                <span>Color</span>
                <input
                  aria-label={`${row.label || "New chip"} color`}
                  disabled={readOnly}
                  type="color"
                  value={row.colorHex}
                  onChange={(event) => updateRow(row.id, { colorHex: event.currentTarget.value })}
                />
              </label>
              <label>
                <span>Name</span>
                <input
                  aria-label="Chip color name"
                  disabled={readOnly}
                  value={row.label}
                  placeholder="Blue"
                  onChange={(event) => updateRow(row.id, { label: event.currentTarget.value })}
                />
              </label>
              <label>
                <span>Value</span>
                <input
                  aria-label={`${row.label || "New chip"} value`}
                  disabled={readOnly}
                  inputMode="decimal"
                  value={row.valueInput}
                  placeholder="0.25"
                  onChange={(event) => updateRow(row.id, { valueInput: event.currentTarget.value })}
                />
              </label>
              <button
                className="icon-button danger"
                type="button"
                disabled={readOnly}
                title={`Remove ${row.label || "chip"}`}
                onClick={() => {
                  setRows((current) => current.filter((item) => item.id !== row.id));
                  setSaved(false);
                }}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="chip-key-footer">
        <span className="muted">Values are saved in USD and may be changed later.</span>
        <button className="primary-button" type="button" disabled={readOnly} onClick={saveKey}>
          <Save size={16} />
          Save chip key
        </button>
      </div>
      {error ? <div className="notice notice-warning">{error}</div> : null}
      {saved ? <div className="notice notice-ok">Chip value key saved.</div> : null}
    </section>
  );
}
