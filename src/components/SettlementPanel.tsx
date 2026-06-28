import { ArrowRight, Scale } from "lucide-react";
import { useMemo, useState } from "react";
import { formatCurrency } from "../domain/money";
import type {
  BankSummary,
  Player,
  PlayerLedgerSummary,
  SettlementPayment
} from "../domain/pokerTypes";
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

function settlementPaymentKey(payment: SettlementPayment): string {
  return `${payment.fromPlayerId}:${payment.toPlayerId}:${payment.amountCents}`;
}

export function SettlementPanel({
  bankSummary,
  imbalanceCents,
  players,
  summaries
}: SettlementPanelProps) {
  const minimizedPayments = useMemo(
    () => buildMinimizedSettlement(summaries),
    [summaries]
  );
  const [settledPaymentKeys, setSettledPaymentKeys] = useState<Set<string>>(
    () => new Set()
  );
  const currentPaymentKeys = useMemo(
    () => new Set(minimizedPayments.map(settlementPaymentKey)),
    [minimizedPayments]
  );
  const settledPaymentCount = minimizedPayments.filter((payment) =>
    settledPaymentKeys.has(settlementPaymentKey(payment))
  ).length;
  const hasSettledPayments = settledPaymentCount > 0;
  const sortedSummaries = [...summaries]
    .filter((summary) => players.some((player) => player.id === summary.playerId))
    .sort((a, b) => Math.abs(b.netCents) - Math.abs(a.netCents));

  function toggleSettlementPayment(payment: SettlementPayment) {
    const paymentKey = settlementPaymentKey(payment);

    setSettledPaymentKeys((previousKeys) => {
      const nextKeys = new Set(previousKeys);

      if (nextKeys.has(paymentKey)) {
        nextKeys.delete(paymentKey);
      } else {
        nextKeys.add(paymentKey);
      }

      return nextKeys;
    });
  }

  function clearSettlementChecks() {
    setSettledPaymentKeys((previousKeys) => {
      const nextKeys = new Set(previousKeys);
      for (const paymentKey of previousKeys) {
        if (currentPaymentKeys.has(paymentKey)) {
          nextKeys.delete(paymentKey);
        }
      }
      return nextKeys;
    });
  }

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
          <div className="settlement-section-heading">
            <div>
              <h3>Player Payments</h3>
              {minimizedPayments.length > 0 ? (
                <p>
                  {settledPaymentCount} of {minimizedPayments.length} payments settled
                </p>
              ) : null}
            </div>
            {hasSettledPayments ? (
              <button className="text-button" type="button" onClick={clearSettlementChecks}>
                Clear checks
              </button>
            ) : null}
          </div>
          <div className="settlement-list">
            {minimizedPayments.length === 0 ? (
              <p className="muted">No player-to-player payments needed.</p>
            ) : (
              minimizedPayments.map((payment) => {
                const paymentKey = settlementPaymentKey(payment);
                const fromPlayerName = playerNameById(players, payment.fromPlayerId);
                const toPlayerName = playerNameById(players, payment.toPlayerId);
                const amount = formatCurrency(payment.amountCents);
                const isSettled = settledPaymentKeys.has(paymentKey);

                return (
                  <label
                    className={`settlement-line payment-line ${
                      isSettled ? "is-settled" : ""
                    }`}
                    key={paymentKey}
                  >
                    <input
                      type="checkbox"
                      checked={isSettled}
                      aria-label={`Mark ${fromPlayerName} to ${toPlayerName} ${amount} as ${
                        isSettled ? "unpaid" : "paid"
                      }`}
                      onChange={() => toggleSettlementPayment(payment)}
                    />
                    <span>{fromPlayerName}</span>
                    <ArrowRight size={15} aria-hidden="true" />
                    <span>{toPlayerName}</span>
                    <strong>{amount}</strong>
                  </label>
                );
              })
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
