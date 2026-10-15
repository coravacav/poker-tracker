import { ArrowRight, Lock, LockOpen, Send } from "lucide-react";
import { formatCurrency } from "../../domain/money";
import type { Player } from "../../domain/pokerTypes";
import {
  playerNameById,
  settlementVenmoPayUrl,
  type SettlementPlanPayment
} from "../../domain/settlement";

export function planPaymentKey(payment: SettlementPlanPayment): string {
  return (
    payment.pinId ??
    `suggested:${payment.fromPlayerId}:${payment.toPlayerId}:${payment.amountCents}`
  );
}

type PaymentLineProps = {
  payment: SettlementPlanPayment;
  players: Player[];
  currencyCode: string;
  gameName: string;
  settlementReady: boolean;
  canEditPayments: boolean;
  pinControlsDisabled: boolean;
  pinControlsTitle: string | undefined;
  togglePaid: (payment: SettlementPlanPayment) => void;
  toggleLocked: (payment: SettlementPlanPayment) => void;
};

/** One planned payment with its paid and lock controls and a Venmo pay link. */
export function PaymentLine({
  payment,
  players,
  currencyCode,
  gameName,
  settlementReady,
  canEditPayments,
  pinControlsDisabled,
  pinControlsTitle,
  togglePaid,
  toggleLocked
}: PaymentLineProps) {
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
}
