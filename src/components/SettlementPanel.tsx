import { ArrowRight, Check, Copy, Lock, LockOpen, Plus, Printer, Scale, Send, X } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { formatCurrency, parseMoneyToCents } from "../domain/money";
import type {
  BankSummary,
  Player,
  PlayerLedgerSummary,
  SettlementPin,
  Transaction
} from "../domain/pokerTypes";
import {
  buildSettlementPlan,
  buildSettlementSummaryText,
  playerNameById,
  settlementVenmoPayUrl,
  type SettlementPlanPayment
} from "../domain/settlement";
import type { GameAction } from "../state/gameReducer";
import { createId } from "../state/seedGame";

export type SettlementPinAction = Extract<
  GameAction,
  {
    type:
      | "pin_settlement_payment"
      | "set_settlement_pin_status"
      | "unpin_settlement_payment"
      | "clear_settlement_pins";
  }
>;

type SettlementPanelProps = {
  bankSummary: BankSummary;
  /** Venmo pay links are offered only for US dollar games. */
  currencyCode?: string;
  imbalanceCents: number;
  hideActions?: boolean;
  gameName?: string;
  players: Player[];
  readOnly: boolean;
  settlementReady: boolean;
  summaries: PlayerLedgerSummary[];
  settlementPins?: SettlementPin[];
  onAddTransaction: (transaction: Transaction) => boolean;
  onSettlementPinAction?: (action: SettlementPinAction) => void;
};

function planPaymentKey(payment: SettlementPlanPayment): string {
  return (
    payment.pinId ??
    `suggested:${payment.fromPlayerId}:${payment.toPlayerId}:${payment.amountCents}`
  );
}

type PinDraft = {
  fromPlayerId: string;
  toPlayerId: string;
  amount: string;
  alreadyPaid: boolean;
};

export function SettlementPanel({
  bankSummary,
  currencyCode = "USD",
  gameName = "Poker Night",
  imbalanceCents,
  hideActions = false,
  players,
  readOnly,
  settlementReady,
  summaries,
  settlementPins = [],
  onAddTransaction,
  onSettlementPinAction
}: SettlementPanelProps) {
  const plan = useMemo(
    () => buildSettlementPlan(summaries, settlementPins),
    [settlementPins, summaries]
  );
  const [coveredPlayerId, setCoveredPlayerId] = useState<string | null>(null);
  const [coveredByPlayerId, setCoveredByPlayerId] = useState<string>("");
  const [coverageNote, setCoverageNote] = useState("");
  const [coverageError, setCoverageError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pinDraft, setPinDraft] = useState<PinDraft | null>(null);
  const [pinDraftError, setPinDraftError] = useState<string | null>(null);
  const canEditPayments = !hideActions && Boolean(onSettlementPinAction);
  const pinControlsDisabled = readOnly || !onSettlementPinAction;
  const pinControlsTitle = readOnly ? "Turn off read-only mode to change payments" : undefined;
  const sortedSummaries = [...summaries]
    .filter((summary) => players.some((player) => player.id === summary.playerId))
    .sort((a, b) => Math.abs(b.netCents) - Math.abs(a.netCents));
  const overpinnedNames = plan.overpinnedPlayerIds.map((playerId) =>
    playerNameById(players, playerId)
  );

  const settlementSummaryText = useMemo(
    () =>
      buildSettlementSummaryText(gameName, players, summaries, settlementPins, {
        currencyCode,
        venmoLinks: settlementReady
      }),
    [currencyCode, gameName, players, settlementPins, settlementReady, summaries]
  );

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(settlementSummaryText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  function pinPayment(payment: SettlementPlanPayment, status: SettlementPin["status"]) {
    onSettlementPinAction?.({
      type: "pin_settlement_payment",
      pin: {
        id: createId("settlement_pin"),
        fromPlayerId: payment.fromPlayerId,
        toPlayerId: payment.toPlayerId,
        amountCents: payment.amountCents,
        status
      }
    });
  }

  function togglePaid(payment: SettlementPlanPayment) {
    if (pinControlsDisabled) return;
    if (!payment.pinId) {
      pinPayment(payment, "paid");
    } else if (payment.status === "locked") {
      onSettlementPinAction?.({
        type: "set_settlement_pin_status",
        pinId: payment.pinId,
        status: "paid"
      });
    } else {
      onSettlementPinAction?.({ type: "unpin_settlement_payment", pinId: payment.pinId });
    }
  }

  function toggleLocked(payment: SettlementPlanPayment) {
    if (pinControlsDisabled) return;
    if (payment.pinId) {
      onSettlementPinAction?.({ type: "unpin_settlement_payment", pinId: payment.pinId });
    } else {
      pinPayment(payment, "locked");
    }
  }

  function openPinDraft() {
    const firstSuggestion = plan.payments.find((payment) => payment.status === "suggested");
    const fallbackFrom = sortedSummaries[0]?.playerId ?? "";
    const fallbackTo =
      sortedSummaries.find((summary) => summary.playerId !== fallbackFrom)?.playerId ?? "";
    setPinDraft({
      fromPlayerId: firstSuggestion?.fromPlayerId ?? fallbackFrom,
      toPlayerId: firstSuggestion?.toPlayerId ?? fallbackTo,
      amount: firstSuggestion ? (firstSuggestion.amountCents / 100).toFixed(2) : "",
      alreadyPaid: false
    });
    setPinDraftError(null);
  }

  function submitPinDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pinDraft || pinControlsDisabled) return;
    const amountCents = parseMoneyToCents(pinDraft.amount);
    if (!pinDraft.fromPlayerId || !pinDraft.toPlayerId) {
      setPinDraftError("Choose who pays and who receives.");
      return;
    }
    if (pinDraft.fromPlayerId === pinDraft.toPlayerId) {
      setPinDraftError("Choose two different players.");
      return;
    }
    if (amountCents === null || amountCents <= 0 || !Number.isSafeInteger(amountCents)) {
      setPinDraftError("Enter an amount greater than zero.");
      return;
    }
    onSettlementPinAction?.({
      type: "pin_settlement_payment",
      pin: {
        id: createId("settlement_pin"),
        fromPlayerId: pinDraft.fromPlayerId,
        toPlayerId: pinDraft.toPlayerId,
        amountCents,
        status: pinDraft.alreadyPaid ? "paid" : "locked"
      }
    });
    setPinDraft(null);
    setPinDraftError(null);
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
        <div className="settlement-share-actions">
          <button className="text-button" type="button" onClick={() => void copySummary()}>
            {copied ? <Check size={15} /> : <Copy size={15} />}
            {copied ? "Copied" : "Copy summary"}
          </button>
          <button className="text-button" type="button" onClick={() => window.print()}>
            <Printer size={15} />
            Print
          </button>
          <Scale size={20} />
        </div>
      </div>

      <div className="settlement-layout">
        <div>
          <div className="settlement-section-heading">
            <div>
              <h3>Player Payments</h3>
              {plan.payments.length > 0 ? (
                <p>
                  {plan.paidCount} of {plan.payments.length} payments settled
                </p>
              ) : null}
            </div>
            {canEditPayments ? (
              <div className="settlement-pin-controls">
                {settlementPins.length > 0 ? (
                  <button
                    className="text-button"
                    type="button"
                    disabled={pinControlsDisabled}
                    title={pinControlsTitle}
                    onClick={() => onSettlementPinAction?.({ type: "clear_settlement_pins" })}
                  >
                    Clear marks
                  </button>
                ) : null}
                <button
                  className="text-button"
                  type="button"
                  disabled={pinControlsDisabled || sortedSummaries.length < 2}
                  title={pinControlsTitle ?? "Add a payment that already happened or that players agreed on"}
                  onClick={openPinDraft}
                >
                  <Plus size={15} />
                  Add payment
                </button>
              </div>
            ) : null}
          </div>
          {pinDraft && canEditPayments ? (
            <form
              className="settlement-pin-form"
              aria-label="Add a fixed payment"
              onSubmit={submitPinDraft}
            >
              <div className="form-grid two">
                <label>
                  <span>Payer</span>
                  <select
                    value={pinDraft.fromPlayerId}
                    onChange={(event) => {
                      const fromPlayerId = event.currentTarget.value;
                      setPinDraft((draft) => (draft ? { ...draft, fromPlayerId } : draft));
                      setPinDraftError(null);
                    }}
                  >
                    {sortedSummaries.map((summary) => (
                      <option key={summary.playerId} value={summary.playerId}>
                        {playerNameById(players, summary.playerId)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Recipient</span>
                  <select
                    value={pinDraft.toPlayerId}
                    onChange={(event) => {
                      const toPlayerId = event.currentTarget.value;
                      setPinDraft((draft) => (draft ? { ...draft, toPlayerId } : draft));
                      setPinDraftError(null);
                    }}
                  >
                    {sortedSummaries.map((summary) => (
                      <option key={summary.playerId} value={summary.playerId}>
                        {playerNameById(players, summary.playerId)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Amount</span>
                  <input
                    inputMode="decimal"
                    value={pinDraft.amount}
                    placeholder="0.00"
                    onChange={(event) => {
                      const amount = event.currentTarget.value;
                      setPinDraft((draft) => (draft ? { ...draft, amount } : draft));
                      setPinDraftError(null);
                    }}
                  />
                </label>
                <label className="settlement-pin-paid">
                  <input
                    type="checkbox"
                    checked={pinDraft.alreadyPaid}
                    onChange={(event) => {
                      const alreadyPaid = event.currentTarget.checked;
                      setPinDraft((draft) => (draft ? { ...draft, alreadyPaid } : draft));
                    }}
                  />
                  <span>Already paid</span>
                </label>
              </div>
              {pinDraftError ? (
                <div className="notice notice-warning">{pinDraftError}</div>
              ) : null}
              <div className="modal-actions">
                <button type="button" onClick={() => setPinDraft(null)}>
                  Cancel
                </button>
                <button className="primary-button" type="submit" disabled={pinControlsDisabled}>
                  Add payment
                </button>
              </div>
            </form>
          ) : null}
          {overpinnedNames.length > 0 ? (
            <div className="notice notice-warning settlement-pin-warning">
              Locked or paid payments are more than {overpinnedNames.join(", ")}{" "}
              {overpinnedNames.length === 1 ? "owes or is owed" : "owe or are owed"}, so the
              remaining payments send the difference back. Check the marked payments.
            </div>
          ) : null}
          <div className="settlement-list">
            {plan.payments.length === 0 ? (
              <p className="muted">No player-to-player payments needed.</p>
            ) : (
              plan.payments.map((payment) => {
                const fromPlayerName = playerNameById(players, payment.fromPlayerId);
                const toPlayerName = playerNameById(players, payment.toPlayerId);
                const amount = formatCurrency(payment.amountCents, currencyCode);
                const isPaid = payment.status === "paid";
                const isLocked = payment.status === "locked";
                const description = `${fromPlayerName} to ${toPlayerName} ${amount}`;
                // Only once balances are final, so nobody pays a provisional amount.
                const venmoUrl = settlementReady
                  ? settlementVenmoPayUrl(payment, players, gameName, currencyCode)
                  : null;

                return (
                  <div
                    className={`settlement-line payment-line ${isPaid ? "is-settled" : ""} ${
                      isLocked ? "is-locked" : ""
                    }`}
                    key={planPaymentKey(payment)}
                  >
                    <label className="payment-line-label">
                      {canEditPayments ? (
                        <input
                          type="checkbox"
                          checked={isPaid}
                          disabled={pinControlsDisabled}
                          aria-label={`Mark ${description} as ${isPaid ? "unpaid" : "paid"}`}
                          onChange={() => togglePaid(payment)}
                        />
                      ) : null}
                      <span>{fromPlayerName}</span>
                      <ArrowRight size={15} aria-hidden="true" />
                      <span>{toPlayerName}</span>
                      {isPaid || isLocked ? (
                        <small className="payment-status">{isPaid ? "Paid" : "Locked"}</small>
                      ) : null}
                      <strong>{amount}</strong>
                    </label>
                    {canEditPayments && !isPaid ? (
                      <button
                        className="icon-button payment-lock-button"
                        type="button"
                        aria-pressed={isLocked}
                        disabled={pinControlsDisabled}
                        aria-label={`${isLocked ? "Unlock" : "Lock"} ${description}`}
                        title={
                          pinControlsTitle ??
                          (isLocked
                            ? "Unlock: let this payment be recomputed"
                            : "Lock: keep this payment and plan the rest around it")
                        }
                        onClick={() => toggleLocked(payment)}
                      >
                        {isLocked ? <Lock size={15} /> : <LockOpen size={15} />}
                      </button>
                    ) : null}
                    {venmoUrl ? (
                      <a
                        className="venmo-pay-link"
                        href={venmoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`${fromPlayerName}: pay ${toPlayerName} ${amount} with Venmo`}
                        title={`Opens Venmo to pay ${toPlayerName} ${amount}`}
                      >
                        <Send size={14} aria-hidden="true" />
                        Pay with Venmo
                      </a>
                    ) : null}
                  </div>
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
                  {formatCurrency(summary.netCents, currencyCode)}
                </strong>
                {summary.netCents < 0 && !hideActions ? (
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
        <span>Net chips in play {formatCurrency(bankSummary.balanceCents, currencyCode)}</span>
        <span>Imbalance {formatCurrency(imbalanceCents, currencyCode)}</span>
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
                <input readOnly value={formatCurrency(coverageAmountCents, currencyCode)} />
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
                  <strong>{formatCurrency(coverageSummary.netCents, currencyCode)} → {formatCurrency(0, currencyCode)}</strong>
                </article>
                <article className="preview-card">
                  <div className="preview-card-heading">
                    <span>{playerNameById(players, coveredByPlayerId)}</span>
                    <small>Coverer</small>
                  </div>
                  <strong>
                    {formatCurrency(covererSummary.netCents, currencyCode)} → {formatCurrency(covererSummary.netCents - coverageAmountCents, currencyCode)}
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
