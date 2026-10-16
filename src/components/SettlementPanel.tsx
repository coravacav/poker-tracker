
import { Check, Copy, ImageDown, Plus, Printer, Scale } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatCurrency } from "../domain/money";
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
  type SettlementPlanPayment
} from "../domain/settlement";
import type { SettlementPinAction } from "../state/gameActions";
import { createId } from "../state/seedGame";
import { buildSettlementImageModel } from "../domain/settlementImage";
import { DebtCoverageDialog } from "./settlementPanel/DebtCoverageDialog";
import { PaymentLine, planPaymentKey } from "./settlementPanel/PaymentLine";
import { PaymentPinForm, type PinDraft } from "./settlementPanel/PaymentPinForm";
import { shareSettlementImage, type ShareImageResult } from "./settlementPanel/settlementImage";

export type { SettlementPinAction };

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
  const [imageResult, setImageResult] = useState<ShareImageResult | "working" | null>(null);
  const imageResetRef = useRef(0);
  useEffect(() => () => window.clearTimeout(imageResetRef.current), []);
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

  async function shareImage() {
    // An earlier share's reset must not unlock this one while its share sheet is open.
    window.clearTimeout(imageResetRef.current);
    setImageResult("working");
    const model = buildSettlementImageModel(gameName, players, summaries, settlementPins, { currencyCode });
    const result = await shareSettlementImage(model).catch((): ShareImageResult => "failed");
    setImageResult(result);
    if (result !== "failed") imageResetRef.current = window.setTimeout(() => setImageResult(null), 1800);
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

  function openDebtCoverage(playerId: string) {
    const fallbackCoverer = sortedSummaries.find(
      (summary) => summary.playerId !== playerId
    );
    setCoveredPlayerId(playerId);
    setCoveredByPlayerId(fallbackCoverer?.playerId ?? "");
    setCoverageNote("");
    setCoverageError(null);
  }

  const coverageSummary = coveredPlayerId
    ? summaries.find((summary) => summary.playerId === coveredPlayerId)
    : undefined;

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
          <button
            className="text-button"
            type="button"
            disabled={imageResult === "working"}
            aria-busy={imageResult === "working"}
            title="A picture of the payments and results, for a group chat"
            onClick={() => void shareImage()}
          >
            <ImageDown size={15} />
            {imageResult === "downloaded"
              ? "Image saved"
              : imageResult === "shared"
                ? "Shared"
                : imageResult === "failed"
                  ? "Image unavailable"
                  : "Share image"}
          </button>
          <span className="sr-only" role="status">
            {imageResult === "downloaded"
              ? "Settlement image saved."
              : imageResult === "shared"
                ? "Settlement image shared."
                : imageResult === "failed"
                  ? "This browser cannot make the settlement image."
                  : ""}
          </span>
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
            <PaymentPinForm
              pinDraft={pinDraft}
              setPinDraft={setPinDraft}
              pinDraftError={pinDraftError}
              setPinDraftError={setPinDraftError}
              pinControlsDisabled={pinControlsDisabled}
              players={players}
              sortedSummaries={sortedSummaries}
              onSettlementPinAction={onSettlementPinAction}
            />
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
              plan.payments.map((payment) => (
                <PaymentLine
                  key={planPaymentKey(payment)}
                  payment={payment}
                  players={players}
                  currencyCode={currencyCode}
                  gameName={gameName}
                  settlementReady={settlementReady}
                  canEditPayments={canEditPayments}
                  pinControlsDisabled={pinControlsDisabled}
                  pinControlsTitle={pinControlsTitle}
                  togglePaid={togglePaid}
                  toggleLocked={toggleLocked}
                />
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
        <DebtCoverageDialog
          coveredPlayerId={coveredPlayerId}
          setCoveredPlayerId={setCoveredPlayerId}
          coverageSummary={coverageSummary}
          coveredByPlayerId={coveredByPlayerId}
          setCoveredByPlayerId={setCoveredByPlayerId}
          coverageNote={coverageNote}
          setCoverageNote={setCoverageNote}
          coverageError={coverageError}
          setCoverageError={setCoverageError}
          currencyCode={currencyCode}
          players={players}
          summaries={summaries}
          sortedSummaries={sortedSummaries}
          onAddTransaction={onAddTransaction}
        />
      ) : null}
    </section>
  );
}
