import { X } from "lucide-react";
import type { GameState, Transaction } from "../../domain/pokerTypes";
import { TransactionForm } from "../TransactionForm";
import type { LedgerOverview } from "./useLedgerOverview";
import { useDialogFocus } from "../useDialogFocus";

type TransactionDrawerProps = {
  state: GameState;
  guest: boolean;
  readOnly: boolean;
  activePlayers: LedgerOverview["activePlayers"];
  bankSummary: LedgerOverview["bankSummary"];
  summaryByPlayerId: LedgerOverview["summaryByPlayerId"];
  addTransaction: (transaction: Transaction) => boolean;
  onSubmitGuestTransaction: (transaction: Transaction) => void;
  setTransactionDrawerOpen: (open: boolean) => void;
};

/** Transaction entry drawer; guests submit requests for the host to approve. */
export function TransactionDrawer({
  state,
  guest,
  readOnly,
  activePlayers,
  bankSummary,
  summaryByPlayerId,
  addTransaction,
  onSubmitGuestTransaction,
  setTransactionDrawerOpen
}: TransactionDrawerProps) {
  const dialogRef = useDialogFocus<HTMLElement>(true, () => setTransactionDrawerOpen(false));
  return (
    <div className="drawer-backdrop" role="presentation">
      <section
        ref={dialogRef}
        tabIndex={-1}
        className="drawer-panel"
        role="dialog"
        aria-modal="true"
        aria-label={guest ? "Request transaction" : "Add transaction"}
      >
        <div className="drawer-heading">
          <div>
            <p className="eyebrow">{guest ? "The host approves" : "Ledger entry"}</p>
            <h2>{guest ? "Request Transaction" : "Add Transaction"}</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={() => setTransactionDrawerOpen(false)}
            title="Close"
          >
            <X size={17} />
          </button>
        </div>
        <TransactionForm
          allowFinalCashOut={guest}
          bankBalanceCents={bankSummary.balanceCents}
          chipDenominations={state.settings.chipDenominations}
          defaultBuyInCents={state.settings.defaultBuyInCents}
          onAddTransaction={(transaction) => {
            const added = guest
              ? (onSubmitGuestTransaction(transaction), true)
              : addTransaction(transaction);
            if (added) {
              setTransactionDrawerOpen(false);
            }
            return added;
          }}
          players={activePlayers}
          readOnly={guest ? false : readOnly}
          submitLabel={guest ? "Send to host" : undefined}
          summaryByPlayerId={summaryByPlayerId}
        />
      </section>
    </div>
  );
}
