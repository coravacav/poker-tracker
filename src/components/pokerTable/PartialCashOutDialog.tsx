import { X } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { centsToInputValue, parseMoneyToCents } from "../../domain/money";
import type { PlayerId, PlayerLedgerSummary, Transaction } from "../../domain/pokerTypes";
import { createId } from "../../state/seedGame";
import { LedgerImpactPreview } from "../TransferPreview";
import { TransferQuickAmountButtons } from "../TransferQuickAmountButtons";

export type PartialCashOutDraft = {
  playerId: PlayerId;
  amountInput: string;
  note: string;
};

type PartialCashOutDialogProps = {
  partialCashOutDraft: PartialCashOutDraft;
  setPartialCashOutDraft: Dispatch<SetStateAction<PartialCashOutDraft | null>>;
  partialCashOutError: string | null;
  setPartialCashOutError: Dispatch<SetStateAction<string | null>>;
  bankBalanceCents: number;
  defaultBuyInCents: number;
  summaryByPlayerId: Map<PlayerId, PlayerLedgerSummary>;
  onAddTransaction: (transaction: Transaction) => boolean;
  playerName: (playerId: PlayerId) => string;
};

export function PartialCashOutDialog({
  partialCashOutDraft,
  setPartialCashOutDraft,
  partialCashOutError,
  setPartialCashOutError,
  bankBalanceCents,
  defaultBuyInCents,
  summaryByPlayerId,
  onAddTransaction,
  playerName
}: PartialCashOutDialogProps) {
  function confirmPartialCashOut() {
    if (!partialCashOutDraft) return;
    const amountCents = parseMoneyToCents(partialCashOutDraft.amountInput);
    if (!amountCents || amountCents <= 0) {
      setPartialCashOutError("Enter a positive cash-out amount.");
      return;
    }

    const added = onAddTransaction({
      id: createId("transaction"),
      type: "bank_cash_out",
      cashOutKind: "partial",
      createdAt: new Date().toISOString(),
      amountCents,
      fromPlayerId: partialCashOutDraft.playerId,
      note: partialCashOutDraft.note.trim() || undefined
    });

    if (added) {
      setPartialCashOutDraft(null);
      setPartialCashOutError(null);
    }
  }

  const partialCashOutAmountCents = partialCashOutDraft
    ? parseMoneyToCents(partialCashOutDraft.amountInput)
    : null;
  const partialCashOutPlayerNet = partialCashOutDraft
    ? summaryByPlayerId.get(partialCashOutDraft.playerId)?.netCents ?? 0
    : 0;

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="modal table-action-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Partial cash-out"
      >
        <div className="modal-heading">
          <div>
            <p className="eyebrow">Partial cash-out</p>
            <h2>Cash out {playerName(partialCashOutDraft.playerId)}</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={() => setPartialCashOutDraft(null)}
            title="Close"
          >
            <X size={17} />
          </button>
        </div>

        <p className="muted">
          Record a during-game payout without marking this player finished for the night.
        </p>

        <div className="form-grid two">
          <label>
            <span>Amount</span>
            <input
              inputMode="decimal"
              value={partialCashOutDraft.amountInput}
              onChange={(event) => {
                setPartialCashOutDraft({
                  ...partialCashOutDraft,
                  amountInput: event.currentTarget.value
                });
                setPartialCashOutError(null);
              }}
            />
          </label>
          <label>
            <span>Note</span>
            <input
              value={partialCashOutDraft.note}
              placeholder="Optional"
              onChange={(event) =>
                setPartialCashOutDraft({
                  ...partialCashOutDraft,
                  note: event.currentTarget.value
                })
              }
            />
          </label>
        </div>

        <div className="quick-amounts">
          <TransferQuickAmountButtons
            defaultBuyInCents={defaultBuyInCents}
            onSelect={(amountCents) => {
              setPartialCashOutDraft({
                ...partialCashOutDraft,
                amountInput: centsToInputValue(amountCents)
              });
              setPartialCashOutError(null);
            }}
          />
        </div>

        {partialCashOutAmountCents !== null && partialCashOutAmountCents > 0 ? (
          <LedgerImpactPreview
            ariaLabel="Partial cash-out preview"
            impacts={[
              {
                currentCents: partialCashOutPlayerNet,
                deltaCents: partialCashOutAmountCents,
                name: playerName(partialCashOutDraft.playerId),
                role: "Player net"
              },
              {
                currentCents: bankBalanceCents,
                deltaCents: -partialCashOutAmountCents,
                name: "Chip Pool",
                role: "In play"
              }
            ]}
          />
        ) : null}

        {partialCashOutError ? (
          <div className="notice notice-warning">{partialCashOutError}</div>
        ) : null}
        <div className="modal-actions">
          <button type="button" onClick={() => setPartialCashOutDraft(null)}>
            Cancel
          </button>
          <button className="primary-button" type="button" onClick={confirmPartialCashOut}>
            Record partial cash-out
          </button>
        </div>
      </section>
    </div>
  );
}
