import { ArrowRight, Scale } from "lucide-react";
import { formatCurrency } from "../domain/money";
import type { BankSummary, Player, PlayerLedgerSummary } from "../domain/pokerTypes";
import {
  buildMinimizedSettlement,
  playerNameById
} from "../domain/settlement";

type SettlementPanelProps = {
  bankSummary: BankSummary;
  imbalanceCents: number;
  players: Player[];
  summaries: PlayerLedgerSummary[];
};

export function SettlementPanel({
  bankSummary,
  imbalanceCents,
  players,
  summaries
}: SettlementPanelProps) {
  const minimizedPayments = buildMinimizedSettlement(summaries);
  const sortedSummaries = [...summaries]
    .filter((summary) => players.some((player) => player.id === summary.playerId))
    .sort((a, b) => Math.abs(b.netCents) - Math.abs(a.netCents));

  return (
    <section className="panel settlement-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Live totals</p>
          <h2>Settlement</h2>
        </div>
        <Scale size={20} />
      </div>

      <div className="settlement-layout">
        <div>
          <h3>Player Payments</h3>
          <div className="settlement-list">
            {minimizedPayments.length === 0 ? (
              <p className="muted">No player-to-player payments needed.</p>
            ) : (
              minimizedPayments.map((payment) => (
                <div
                  className="settlement-line payment-line"
                  key={`${payment.fromPlayerId}-${payment.toPlayerId}-${payment.amountCents}`}
                >
                  <span>{playerNameById(players, payment.fromPlayerId)}</span>
                  <ArrowRight size={15} />
                  <span>{playerNameById(players, payment.toPlayerId)}</span>
                  <strong>{formatCurrency(payment.amountCents)}</strong>
                </div>
              ))
            )}
          </div>
        </div>

        <div>
          <h3>Player Net</h3>
          <div className="settlement-list">
            {sortedSummaries.map((summary) => (
              <div className="settlement-line" key={summary.playerId}>
                <span>{playerNameById(players, summary.playerId)}</span>
                <strong
                  className={
                    summary.netCents > 0
                      ? "positive"
                      : summary.netCents < 0
                        ? "negative"
                        : "neutral"
                  }
                >
                  {formatCurrency(summary.netCents)}
                </strong>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="settlement-footer">
        <span>Net chips in play {formatCurrency(bankSummary.balanceCents)}</span>
        <span>Imbalance {formatCurrency(imbalanceCents)}</span>
      </div>
    </section>
  );
}
