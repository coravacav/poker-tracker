import { X } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { centsToInputValue, parseMoneyToCents } from "../../domain/money";
import type { Player, PlayerId, PlayerLedgerSummary, Transaction } from "../../domain/pokerTypes";
import { createId } from "../../state/seedGame";
import { useFormatCurrency } from "../CurrencyContext";
import { LedgerImpactPreview, TransferPreview } from "../TransferPreview";
import { TransferQuickAmountButtons } from "../TransferQuickAmountButtons";
import { useDialogFocus } from "../useDialogFocus";

export type TransferDraft = {
  mode: "player_gave" | "player_owes" | "cover_buy_in";
  fromPlayerId: PlayerId;
  toPlayerId: PlayerId;
  amountInput: string;
  note: string;
};

type TransferDialogProps = {
  transferDraft: TransferDraft;
  setTransferDraft: Dispatch<SetStateAction<TransferDraft | null>>;
  transferError: string | null;
  setTransferError: Dispatch<SetStateAction<string | null>>;
  activePlayers: Player[];
  bankBalanceCents: number;
  defaultBuyInCents: number;
  summaryByPlayerId: Map<PlayerId, PlayerLedgerSummary>;
  onAddTransaction: (transaction: Transaction) => boolean;
  playerName: (playerId: PlayerId) => string;
};

/** Player-to-player transaction: gave, owes, or covering another player's buy-in. */
export function TransferDialog({
  transferDraft,
  setTransferDraft,
  transferError,
  setTransferError,
  activePlayers,
  bankBalanceCents,
  defaultBuyInCents,
  summaryByPlayerId,
  onAddTransaction,
  playerName
}: TransferDialogProps) {
  const dialogRef = useDialogFocus<HTMLElement>(true, () => setTransferDraft(null));
  const formatCurrency = useFormatCurrency();

  function confirmTransfer() {
    if (!transferDraft) {
      return;
    }

    const amountCents = parseMoneyToCents(transferDraft.amountInput);
    if (transferDraft.fromPlayerId === transferDraft.toPlayerId) {
      setTransferError("Choose two different players.");
      return;
    }

    if (!amountCents || amountCents <= 0) {
      setTransferError("Enter a positive transfer amount.");
      return;
    }

    const added = onAddTransaction(
      transferDraft.mode === "cover_buy_in"
        ? {
            id: createId("transaction"),
            type: "bank_buy_in",
            createdAt: new Date().toISOString(),
            amountCents,
            toPlayerId: transferDraft.toPlayerId,
            coveredByPlayerId: transferDraft.fromPlayerId,
            note: transferDraft.note.trim() || undefined
          }
        : {
            id: createId("transaction"),
            type: transferDraft.mode,
            createdAt: new Date().toISOString(),
            amountCents,
            fromPlayerId: transferDraft.fromPlayerId,
            toPlayerId: transferDraft.toPlayerId,
            category: transferDraft.mode === "player_owes" ? "food" : "poker",
            note: transferDraft.note.trim() || undefined
          }
    );

    if (added) {
      setTransferDraft(null);
      setTransferError(null);
    }
  }

  const transferPreviewAmountCents = transferDraft
    ? parseMoneyToCents(transferDraft.amountInput)
    : null;
  const showTransferPreview =
    !!transferDraft &&
    !!transferPreviewAmountCents &&
    transferPreviewAmountCents > 0 &&
    transferDraft.fromPlayerId !== transferDraft.toPlayerId;
  const transferFromCurrentNet = transferDraft
    ? summaryByPlayerId.get(transferDraft.fromPlayerId)?.netCents ?? 0
    : 0;
  const transferToCurrentNet = transferDraft
    ? summaryByPlayerId.get(transferDraft.toPlayerId)?.netCents ?? 0
    : 0;

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        ref={dialogRef}
        tabIndex={-1}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Player transaction"
      >
        <div className="modal-heading">
          <div>
            <p className="eyebrow">
              {transferDraft.mode === "cover_buy_in"
                ? "Covered buy-in"
                : transferDraft.mode === "player_owes"
                  ? "Player owes"
                  : "Player gave"}
            </p>
            <h2>
              {transferDraft.mode === "cover_buy_in"
                ? `${playerName(transferDraft.toPlayerId)} receives from ${playerName(transferDraft.fromPlayerId)}`
                : transferDraft.mode === "player_owes"
                  ? `${playerName(transferDraft.fromPlayerId)} owes ${playerName(transferDraft.toPlayerId)}`
                  : `${playerName(transferDraft.toPlayerId)} receives from ${playerName(transferDraft.fromPlayerId)}`}
            </h2>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={() => setTransferDraft(null)}
            title="Close"
          >
            <X size={17} />
          </button>
        </div>

        <div className="shape-segments transfer-mode-segments" aria-label="Transfer action">
          <button
            type="button"
            aria-pressed={transferDraft.mode === "player_gave"}
            onClick={() =>
              setTransferDraft({ ...transferDraft, mode: "player_gave" })
            }
          >
            Player gave
          </button>
          <button
            type="button"
            aria-pressed={transferDraft.mode === "player_owes"}
            onClick={() =>
              setTransferDraft({ ...transferDraft, mode: "player_owes" })
            }
          >
            Player owes
          </button>
          <button
            type="button"
            aria-pressed={transferDraft.mode === "cover_buy_in"}
            onClick={() =>
              setTransferDraft({ ...transferDraft, mode: "cover_buy_in" })
            }
          >
            Cover buy-in
          </button>
        </div>

        <div className="form-grid two">
          <label>
            <span>
              {transferDraft.mode === "cover_buy_in"
                ? "Covered by"
                : transferDraft.mode === "player_owes"
                  ? "Owes"
                  : "From"}
            </span>
            <select
              value={transferDraft.fromPlayerId}
              onChange={(event) =>
                setTransferDraft({
                  ...transferDraft,
                  fromPlayerId: event.currentTarget.value
                })
              }
            >
              {activePlayers.map((player) => (
                <option key={player.id} value={player.id}>
                  {player.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>
              {transferDraft.mode === "cover_buy_in"
                ? "Chips to"
                : transferDraft.mode === "player_owes"
                  ? "Owed to"
                  : "To"}
            </span>
            <select
              value={transferDraft.toPlayerId}
              onChange={(event) =>
                setTransferDraft({
                  ...transferDraft,
                  toPlayerId: event.currentTarget.value
                })
              }
            >
              {activePlayers.map((player) => (
                <option key={player.id} value={player.id}>
                  {player.name}
                </option>
              ))}
            </select>
          </label>
          {showTransferPreview && transferDraft ? (
            transferDraft.mode === "cover_buy_in" ? (
              <div className="covered-buy-in-preview">
                <LedgerImpactPreview
                  ariaLabel="Covered buy-in preview"
                  impacts={[
                    {
                      currentCents: transferFromCurrentNet,
                      deltaCents: -(transferPreviewAmountCents ?? 0),
                      name: playerName(transferDraft.fromPlayerId),
                      role: "Coverer"
                    },
                    {
                      currentCents: bankBalanceCents,
                      deltaCents: transferPreviewAmountCents ?? 0,
                      name: "Chip Pool",
                      role: "In play"
                    }
                  ]}
                />
                <p className="muted transfer-recipient-note">
                  {playerName(transferDraft.toPlayerId)} receives {formatCurrency(transferPreviewAmountCents ?? 0)} in chips; their net is unchanged.
                </p>
              </div>
            ) : (
              <TransferPreview
                amountCents={transferPreviewAmountCents ?? 0}
                fromCurrentNetCents={transferFromCurrentNet}
                fromName={playerName(transferDraft.fromPlayerId)}
                toCurrentNetCents={transferToCurrentNet}
                toName={playerName(transferDraft.toPlayerId)}
                mode={transferDraft.mode === "player_owes" ? "owes" : "gave"}
              />
            )
          ) : null}
        </div>

        <div className="form-grid transfer-detail-grid">
          <label>
            <span>Amount</span>
            <input
              inputMode="decimal"
              value={transferDraft.amountInput}
              onChange={(event) =>
                setTransferDraft({
                  ...transferDraft,
                  amountInput: event.currentTarget.value
                })
              }
            />
          </label>
          <label>
            <span>Note</span>
            <input
              value={transferDraft.note}
              onChange={(event) =>
                setTransferDraft({
                  ...transferDraft,
                  note: event.currentTarget.value
                })
              }
            />
          </label>
        </div>

        <div className="quick-amounts">
          <TransferQuickAmountButtons
            defaultBuyInCents={defaultBuyInCents}
            onSelect={(amountCents) =>
              setTransferDraft({
                ...transferDraft,
                amountInput: centsToInputValue(amountCents)
              })
            }
          />
        </div>

        {transferError ? <div className="notice notice-warning">{transferError}</div> : null}
        <div className="modal-actions">
          <button type="button" onClick={() => setTransferDraft(null)}>
            Cancel
          </button>
          <button className="primary-button" type="button" onClick={confirmTransfer}>
            {transferDraft.mode === "cover_buy_in"
              ? "Record covered buy-in"
              : transferDraft.mode === "player_owes"
                ? "Record player owes"
                : "Record player gave"}
          </button>
        </div>
      </section>
    </div>
  );
}
