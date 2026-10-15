import type { Dispatch, FormEvent, SetStateAction } from "react";
import { parseMoneyToCents } from "../../domain/money";
import type { Player, PlayerLedgerSummary } from "../../domain/pokerTypes";
import { playerNameById } from "../../domain/settlement";
import type { SettlementPinAction } from "../../state/gameActions";
import { createId } from "../../state/seedGame";

export type PinDraft = {
  fromPlayerId: string;
  toPlayerId: string;
  amount: string;
  alreadyPaid: boolean;
};

type PaymentPinFormProps = {
  pinDraft: PinDraft;
  setPinDraft: Dispatch<SetStateAction<PinDraft | null>>;
  pinDraftError: string | null;
  setPinDraftError: Dispatch<SetStateAction<string | null>>;
  pinControlsDisabled: boolean;
  players: Player[];
  sortedSummaries: PlayerLedgerSummary[];
  onSettlementPinAction?: (action: SettlementPinAction) => void;
};

/** Adds a payment that already happened or that players agreed on. */
export function PaymentPinForm({
  pinDraft,
  setPinDraft,
  pinDraftError,
  setPinDraftError,
  pinControlsDisabled,
  players,
  sortedSummaries,
  onSettlementPinAction
}: PaymentPinFormProps) {
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

  return (
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
  );
}
