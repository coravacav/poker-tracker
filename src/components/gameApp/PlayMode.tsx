import type { Dispatch } from "react";
import type { GameState, Transaction } from "../../domain/pokerTypes";
import { repeatTransaction } from "../../domain/quickEntry";
import type { GameAction } from "../../state/gameReducer";
import { createId } from "../../state/seedGame";
import { BankSummaryPanel } from "../BankSummary";
import { IconKey } from "../IconKey";
import { PokerTable } from "../PokerTable";
import type { LedgerOverview } from "./useLedgerOverview";

type PlayModeProps = {
  state: GameState;
  dispatch: Dispatch<GameAction>;
  guest: boolean;
  readOnly: boolean;
  notice: string | null;
  sessionNotice: string | null;
  layoutEditing: boolean;
  compactPlayerView: boolean;
  activePlayers: LedgerOverview["activePlayers"];
  bankSummary: LedgerOverview["bankSummary"];
  cashedOutPlayerIds: LedgerOverview["cashOutOverview"]["completedPlayerIds"];
  imbalanceCents: number;
  summaryByPlayerId: LedgerOverview["summaryByPlayerId"];
  repeatableTransaction: LedgerOverview["repeatableTransaction"];
  addTransaction: (transaction: Transaction) => boolean;
  addDefaultBuyInToAll: () => void;
  handleCompactPlayerViewChange: (compactView: boolean) => void;
  setAuditDrawerOpen: (open: boolean) => void;
  setTransactionDrawerOpen: (open: boolean) => void;
};

/** Play mode: the poker table plus the chip pool summary and play actions rail. */
export function PlayMode({
  state,
  dispatch,
  guest,
  readOnly,
  notice,
  sessionNotice,
  layoutEditing,
  compactPlayerView,
  activePlayers,
  bankSummary,
  cashedOutPlayerIds,
  imbalanceCents,
  summaryByPlayerId,
  repeatableTransaction,
  addTransaction,
  addDefaultBuyInToAll,
  handleCompactPlayerViewChange,
  setAuditDrawerOpen,
  setTransactionDrawerOpen
}: PlayModeProps) {
  return (
    <div className={`play-mode ${compactPlayerView ? "is-compact-player-view" : ""}`}>
      <section
        className="play-table-area"
        aria-label={compactPlayerView ? "Players" : "Poker table"}
      >
        {notice || sessionNotice ? (
          <div className="notice notice-warning">{notice ?? sessionNotice}</div>
        ) : null}
        <PokerTable
          activePlayers={activePlayers}
          bankBalanceCents={bankSummary.balanceCents}
          cashedOutPlayerIds={cashedOutPlayerIds}
          defaultBuyInCents={state.settings.defaultBuyInCents}
          dispatch={dispatch}
          hideActions={guest}
          onAddTransaction={addTransaction}
          layoutEditing={layoutEditing}
          onCompactViewChange={handleCompactPlayerViewChange}
          readOnly={readOnly}
          tableSeatPlacements={state.settings.tableSeatPlacements}
          tableShape={state.settings.tableShape}
          summaryByPlayerId={summaryByPlayerId}
        />
      </section>

      <aside className="play-rail" aria-label="Play controls">
        <BankSummaryPanel
          bankSummary={bankSummary}
          imbalanceCents={imbalanceCents}
          variant="compact"
        />
        {!compactPlayerView && !guest ? <IconKey layoutEditing={layoutEditing} /> : null}
        <div className="play-actions">
          <button
            className="text-button rail-action"
            type="button"
            onClick={() => setAuditDrawerOpen(true)}
          >
            Transaction Audit
          </button>
          {!guest ? <button
            className="text-button rail-action"
            type="button"
            disabled={readOnly || activePlayers.length === 0}
            onClick={addDefaultBuyInToAll}
          >
            Add default buy-in to all
          </button> : null}
          {!guest && repeatableTransaction ? (
            <button
              className="text-button rail-action"
              type="button"
              disabled={readOnly}
              onClick={() => addTransaction(repeatTransaction(
                repeatableTransaction,
                createId("transaction"),
                new Date().toISOString()
              ))}
            >
              Repeat last transaction
            </button>
          ) : null}
          {guest ? (
            <button
              className="primary-button rail-action"
              type="button"
              onClick={() => setTransactionDrawerOpen(true)}
            >
              Request transaction
            </button>
          ) : <button
            className="primary-button rail-action"
            type="button"
            disabled={readOnly}
            onClick={() => setTransactionDrawerOpen(true)}
          >
            Add transaction
          </button>}
        </div>
      </aside>
    </div>
  );
}
