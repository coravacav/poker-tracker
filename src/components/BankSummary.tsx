import { Landmark, TriangleAlert } from "lucide-react";
import { formatCurrency } from "../domain/money";
import type { BankSummary } from "../domain/pokerTypes";

type BankSummaryPanelProps = {
  bankSummary: BankSummary;
  imbalanceCents: number;
};

export function BankSummaryPanel({
  bankSummary,
  imbalanceCents
}: BankSummaryPanelProps) {
  return (
    <section className="panel bank-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Cash box</p>
          <h2>Bank</h2>
        </div>
        <Landmark size={21} />
      </div>

      <dl className="metric-grid">
        <div>
          <dt>Incoming</dt>
          <dd>{formatCurrency(bankSummary.incomingCents)}</dd>
        </div>
        <div>
          <dt>Outgoing</dt>
          <dd>{formatCurrency(bankSummary.outgoingCents)}</dd>
        </div>
        <div className="metric-wide">
          <dt>Balance</dt>
          <dd>{formatCurrency(bankSummary.balanceCents)}</dd>
        </div>
      </dl>

      {imbalanceCents !== 0 ? (
        <div className="notice notice-warning">
          <TriangleAlert size={16} />
          Ledger imbalance: {formatCurrency(imbalanceCents)}
        </div>
      ) : (
        <div className="notice notice-ok">Ledger balances exactly.</div>
      )}
    </section>
  );
}
