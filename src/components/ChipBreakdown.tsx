import { formatCurrency } from "../domain/money";
import { chipCountLineTotalCents, chipCountTotalCents } from "../domain/chipCounts";
import type { ChipCountLine } from "../domain/pokerTypes";

type ChipBreakdownProps = {
  lines: ChipCountLine[];
  disclosure?: boolean;
};

function BreakdownContent({ lines }: { lines: ChipCountLine[] }) {
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
      <div className="chip-breakdown-total">
        <span>Total</span>
        <strong>{formatCurrency(chipCountTotalCents(lines))}</strong>
      </div>
    </div>
  );
}

export function ChipBreakdown({ lines, disclosure = false }: ChipBreakdownProps) {
  if (disclosure) {
    return (
      <details className="chip-breakdown-details">
        <summary>Chip breakdown</summary>
        <BreakdownContent lines={lines} />
      </details>
    );
  }

  return <BreakdownContent lines={lines} />;
}
