import { ArrowRight, Scale, X } from "lucide-react";
import { useMemo, useState } from "react";
import { formatCurrency } from "../domain/money";
import type {
  BankSummary,
  Player,
  PlayerLedgerSummary,
  SettlementPayment,
  Transaction
} from "../domain/pokerTypes";
import {
  buildMinimizedSettlement,
  playerNameById
} from "../domain/settlement";
import { createId } from "../state/seedGame";

type SettlementPanelProps = {
  bankSummary: BankSummary;
  imbalanceCents: number;
  players: Player[];
  readOnly: boolean;
  settlementReady: boolean;
  summaries: PlayerLedgerSummary[];
  onAddTransaction: (transaction: Transaction) => boolean;
};

function settlementPaymentKey(payment: SettlementPayment): string {
  return `${payment.fromPlayerId}:${payment.toPlayerId}:${payment.amountCents}`;
}

export function SettlementPanel({
  bankSummary,
  imbalanceCents,
  players,
  readOnly,
  settlementReady,
  summaries,
  onAddTransaction
}: SettlementPanelProps) {
  const minimizedPayments = useMemo(
    () => buildMinimizedSettlement(summaries),
    [summaries]
  );
  const [settledPaymentKeys, setSettledPaymentKeys] = useState<Set<string>>(
    () => new Set()
  );
  const [coveredPlayerId, setCoveredPlayerId] = useState<string | null>(null);
  const [coveredByPlayerId, setCoveredByPlayerId] = useState<string>("");
  const [coverageNote, setCoverageNote] = useState("");
  const [coverageError, setCoverageError] = useState<string | null>(null);
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

  function openDebtCoverage(playerId: string) {
    const fallbackCoverer = sortedSummaries.find(
      (summary) => summary.playerId !== playerId
    );
    setCoveredPlayerId(playerId);
    setCoveredByPlayerId(fallbackCoverer?.playerId ?? "");
    setCoverageNote("");
    setCoverageError(null);
  }

  function recordDebtCoverage() {
    if (!coveredPlayerId || !coveredByPlayerId) {
      setCoverageError("Choose a player to cover this debt.");
      return;
    }

    const currentSummary = summaries.find(
      (summary) => summary.playerId === coveredPlayerId
    );
    if (!currentSummary || currentSummary.netCents >= 0) {
      setCoverageError("This player no longer has a debt to cover.");
      return;
    }

    const added = onAddTransaction({
      id: createId("transaction"),
      type: "debt_coverage",
      createdAt: new Date().toISOString(),
      amountCents: Math.abs(currentSummary.netCents),
      coveredPlayerId,
      coveredByPlayerId,
      note: coverageNote.trim() || undefined
    });

    if (added) {
      setCoveredPlayerId(null);
      setCoverageError(null);
    } else {
      setCoverageError("Balances changed. Review the refreshed amount and try again.");
    }
  }

  const coverageSummary = coveredPlayerId
    ? summaries.find((summary) => summary.playerId === coveredPlayerId)
    : undefined;
  const covererSummary = coveredByPlayerId
    ? summaries.find((summary) => summary.playerId === coveredByPlayerId)
    : undefined;
  const coverageAmountCents = coverageSummary && coverageSummary.netCents < 0
    ? Math.abs(coverageSummary.netCents)
    : 0;

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
                {summary.netCents < 0 ? (
                  <button
                    className="text-button cover-debt-button"
                    type="button"
                    disabled={readOnly || !settlementReady}
                    title={
                      readOnly
                        ? "Turn off read-only mode to cover debt"
                        : settlementReady
                          ? `Cover ${playerNameById(players, summary.playerId)}'s full debt`
                          : "Complete all cash-outs and balance the chip pool before covering debt"
                    }
                    onClick={() => openDebtCoverage(summary.playerId)}
                  >
                    Cover debt
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="settlement-footer">
        <span>Net chips in play {formatCurrency(bankSummary.balanceCents)}</span>
        <span>Imbalance {formatCurrency(imbalanceCents)}</span>
      </div>

      {coveredPlayerId && coverageSummary ? (
        <div className="modal-backdrop" role="presentation">
          <section
            className="modal table-action-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Cover full debt"
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Settlement adjustment</p>
                <h2>Cover {playerNameById(players, coveredPlayerId)}'s full debt</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                title="Close"
                onClick={() => setCoveredPlayerId(null)}
              >
                <X size={17} />
              </button>
            </div>

            <div className="form-grid two">
              <label>
                <span>Covered player</span>
                <input
                  readOnly
                  value={playerNameById(players, coveredPlayerId)}
                />
              </label>
              <label>
                <span>Covered by</span>
                <select
                  value={coveredByPlayerId}
                  onChange={(event) => {
                    setCoveredByPlayerId(event.currentTarget.value);
                    setCoverageError(null);
                  }}
                >
                  {sortedSummaries
                    .filter((summary) => summary.playerId !== coveredPlayerId)
                    .map((summary) => (
                      <option key={summary.playerId} value={summary.playerId}>
                        {playerNameById(players, summary.playerId)}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                <span>Full debt amount</span>
                <input readOnly value={formatCurrency(coverageAmountCents)} />
              </label>
              <label>
                <span>Note</span>
                <input
                  value={coverageNote}
                  placeholder="Optional"
                  onChange={(event) => setCoverageNote(event.currentTarget.value)}
                />
              </label>
            </div>

            {covererSummary ? (
              <div className="debt-coverage-preview" aria-label="Debt coverage preview">
                <article className="preview-card">
                  <div className="preview-card-heading">
                    <span>{playerNameById(players, coveredPlayerId)}</span>
                    <small>Covered player</small>
                  </div>
                  <strong>{formatCurrency(coverageSummary.netCents)} → $0.00</strong>
                </article>
                <article className="preview-card">
                  <div className="preview-card-heading">
                    <span>{playerNameById(players, coveredByPlayerId)}</span>
                    <small>Coverer</small>
                  </div>
                  <strong>
                    {formatCurrency(covererSummary.netCents)} → {formatCurrency(covererSummary.netCents - coverageAmountCents)}
                  </strong>
                </article>
              </div>
            ) : null}

            {coverageError ? (
              <div className="notice notice-warning">{coverageError}</div>
            ) : null}

            <div className="modal-actions">
              <button type="button" onClick={() => setCoveredPlayerId(null)}>
                Cancel
              </button>
              <button
                className="primary-button"
                type="button"
                disabled={!coveredByPlayerId || coverageAmountCents <= 0}
                onClick={recordDebtCoverage}
              >
                Record debt coverage
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
