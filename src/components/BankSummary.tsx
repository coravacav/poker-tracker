import { CircleDollarSign, TriangleAlert } from "lucide-react";
import { formatCurrency } from "../domain/money";
import type { BankSummary } from "../domain/pokerTypes";

type BankSummaryPanelProps = {
  bankSummary: BankSummary;
  imbalanceCents: number;
  variant?: "full" | "compact";
};

export function BankSummaryPanel({
  bankSummary,
  imbalanceCents,
  variant = "full"
}: BankSummaryPanelProps) {
  if (variant === "compact") {
    return (
      <section className="panel bank-panel bank-panel-compact" aria-label="Chip pool">
        <div className="compact-bank-heading">
          <CircleDollarSign size={18} />
          <h2>Chip Pool</h2>
        </div>
        <dl className="compact-metrics">
          <div>
            <dt>Issued</dt>
            <dd>{formatCurrency(bankSummary.incomingCents)}</dd>
          </div>
          <div>
            <dt>Returned</dt>
            <dd>{formatCurrency(bankSummary.outgoingCents)}</dd>
          </div>
          <div>
            <dt>In play</dt>
            <dd>{formatCurrency(bankSummary.balanceCents)}</dd>
          </div>
          <div>
            <dt>Imbalance</dt>
            <dd className={imbalanceCents === 0 ? "positive" : "negative"}>
              {formatCurrency(imbalanceCents)}
            </dd>
          </div>
        </dl>
      </section>
    );
  }

  return (
    <section className="panel bank-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Available chips</p>
          <h2>Chip Pool</h2>
        </div>
        <CircleDollarSign size={21} />
      </div>

      <dl className="metric-grid">
        <div>
          <dt>Issued</dt>
          <dd>{formatCurrency(bankSummary.incomingCents)}</dd>
        </div>
        <div>
          <dt>Returned</dt>
          <dd>{formatCurrency(bankSummary.outgoingCents)}</dd>
        </div>
        <div className="metric-wide">
          <dt>In play</dt>
          <dd>{formatCurrency(bankSummary.balanceCents)}</dd>
        </div>
      </dl>

      {imbalanceCents !== 0 ? (
        <div className="notice notice-warning">
          <TriangleAlert size={16} />
          Ledger imbalance: {formatCurrency(imbalanceCents)}
        </div>
      ) : (
        <div className="notice notice-ok">Chip ledger balances exactly.</div>
      )}
    </section>
  );
}
