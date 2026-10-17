import { CircleCheck } from "lucide-react";
import type { Dispatch } from "react";
import { formatCurrency } from "../../domain/money";
import type { GameState, Transaction } from "../../domain/pokerTypes";
import type { GameAction } from "../../state/gameReducer";
import { BankSummaryPanel } from "../BankSummary";
import { SettlementPanel } from "../SettlementPanel";
import type { LedgerOverview } from "./useLedgerOverview";

type SettleModeProps = {
  state: GameState;
  dispatch: Dispatch<GameAction>;
  guest: boolean;
  readOnly: boolean;
  bankSummary: LedgerOverview["bankSummary"];
  imbalanceCents: number;
  cashOutOverview: LedgerOverview["cashOutOverview"];
  settlementReady: boolean;
  settlementSummaries: LedgerOverview["settlementSummaries"];
  addTransaction: (transaction: Transaction) => boolean;
  setNotice: (notice: string | null) => void;
  setAuditDrawerOpen: (open: boolean) => void;
};

/** Settle mode: settlement readiness warnings and the settlement plan. */
export function SettleMode({
  state,
  dispatch,
  guest,
  readOnly,
  bankSummary,
  imbalanceCents,
  cashOutOverview,
  settlementReady,
  settlementSummaries,
  addTransaction,
  setNotice,
  setAuditDrawerOpen
}: SettleModeProps) {
  const auditButton = (
    <button
      className="text-button"
      type="button"
      onClick={() => setAuditDrawerOpen(true)}
    >
      Transaction Audit
    </button>
  );
  const settlementPanel = (
    <SettlementPanel
      bankSummary={bankSummary}
      currencyCode={state.settings.currencyCode}
      gameName={state.settings.gameName}
      hideActions={guest}
      imbalanceCents={imbalanceCents}
      onAddTransaction={addTransaction}
      onSettlementPinAction={guest ? undefined : (action) => {
        if (readOnly) {
          setNotice("Reconnect before changing the shared game.");
          return;
        }
        dispatch(action);
      }}
      players={state.players}
      readOnly={readOnly}
      settlementPins={state.settlementPins}
      settlementReady={settlementReady}
      summaries={settlementSummaries}
    />
  );

  // Once every chip is back and the ledger balances, the pool needs no attention:
  // lead with who pays whom and fold the pool into one confirming line.
  if (settlementReady && bankSummary.balanceCents === 0 && imbalanceCents === 0) {
    return (
      <div className="settle-mode is-ready">
        {settlementPanel}
        <section className="settle-toolbar settle-pool-balanced" aria-label="Chip pool">
          <p>
            <CircleCheck size={17} aria-hidden="true" />
            Chip pool balanced: {formatCurrency(bankSummary.incomingCents, state.settings.currencyCode)} issued, all returned.
            {cashOutOverview.missingPlayers.length > 0
              ? " Recorded partial cash-outs cover the pool."
              : null}
          </p>
          {auditButton}
        </section>
      </div>
    );
  }

  return (
    <div className="settle-mode">
      <section className="settle-toolbar" aria-label="Settle controls">
        <BankSummaryPanel
          bankSummary={bankSummary}
          imbalanceCents={imbalanceCents}
          variant="compact"
        />
        <div className="settle-actions">
          {auditButton}
        </div>
      </section>
      {cashOutOverview.missingPlayers.length > 0 || bankSummary.balanceCents !== 0 ? (
        <div className="settle-warnings">
          {cashOutOverview.missingPlayers.length > 0 &&
          !cashOutOverview.cashOutsCompleteForSettlement ? (
            <div className="notice notice-warning">
              Missing cash-outs: {cashOutOverview.missingPlayers.map((player) => player.name).join(", ")}.
            </div>
          ) : null}
          {cashOutOverview.missingPlayers.length > 0 &&
          cashOutOverview.cashOutsCompleteForSettlement ? (
            <div className="notice notice-ok">
              No chips remain in play; recorded partial cash-outs cover the pool.
            </div>
          ) : null}
          {bankSummary.balanceCents !== 0 ? (
            <div className="notice notice-warning">
              The chip pool still has {formatCurrency(bankSummary.balanceCents, state.settings.currencyCode)} remaining.
            </div>
          ) : null}
        </div>
      ) : null}
      {settlementPanel}
    </div>
  );
}
