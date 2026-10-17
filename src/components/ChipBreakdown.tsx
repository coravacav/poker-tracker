import { useFormatCurrency } from "./CurrencyContext";
import { chipCountLineTotalCents, chipCountTotalCents } from "../domain/chipCounts";
import type { ChipCountLine } from "../domain/pokerTypes";

type ChipBreakdownProps = {
  lines: ChipCountLine[];
  disclosure?: boolean;
  /** Off where the caller already shows the same total next to the breakdown. */
  showTotal?: boolean;
};

function BreakdownContent({ lines, showTotal }: { lines: ChipCountLine[]; showTotal: boolean }) {
  const formatCurrency = useFormatCurrency();
  return (
    <div className="chip-breakdown-list">
      {lines.length === 0 ? <p className="muted">Confirmed with no chips.</p> : null}
      {lines.map((line) => (
        <div className="chip-breakdown-line" key={`${line.denominationId}:${line.valueCents}`}>
          <span className="chip-swatch" style={{ backgroundColor: line.colorHex }} aria-hidden="true" />
          <span>{line.label}</span>
          <span>
            {line.count} × {formatCurrency(line.valueCents)}
          </span>
          <strong>{formatCurrency(chipCountLineTotalCents(line))}</strong>
        </div>
      ))}
      {showTotal ? (
        <div className="chip-breakdown-total">
          <span>Total</span>
          <strong>{formatCurrency(chipCountTotalCents(lines))}</strong>
        </div>
      ) : null}
    </div>
  );
}

export function ChipBreakdown({ lines, disclosure = false, showTotal = true }: ChipBreakdownProps) {
  if (disclosure) {
    return (
      <details className="chip-breakdown-details">
        <summary>Chip breakdown</summary>
        <BreakdownContent lines={lines} showTotal={showTotal} />
      </details>
    );
  }

  return <BreakdownContent lines={lines} showTotal={showTotal} />;
}
