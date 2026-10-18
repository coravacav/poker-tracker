import { Coins } from "lucide-react";
import { useFormatCurrency } from "./CurrencyContext";
import type { ChipDenomination } from "../domain/pokerTypes";

type ChipKeyProps = {
  denominations: ChipDenomination[];
};

/** The game's chip colors and values, read-only, for guests, who have no Setup to look them up in. */
export function ChipKey({ denominations }: ChipKeyProps) {
  const formatCurrency = useFormatCurrency();

  return (
    <section className="panel chip-key-card" aria-label="Chip key">
      <div className="compact-bank-heading">
        <Coins size={18} />
        <h2>Chip Key</h2>
      </div>
      <dl>
        {denominations.map((denomination) => (
          <div key={denomination.id}>
            <dt>
              <span
                className="chip-swatch"
                style={{ backgroundColor: denomination.colorHex }}
                aria-hidden="true"
              />
              <span>{denomination.label}</span>
            </dt>
            <dd>{formatCurrency(denomination.valueCents, { trimWholeCents: true })}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
