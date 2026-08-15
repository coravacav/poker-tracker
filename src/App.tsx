import { X } from "lucide-react";
import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { AppShell, type AppMode } from "./components/AppShell";
import { BankSummaryPanel } from "./components/BankSummary";
import { CashOutMode } from "./components/CashOutMode";
import { ChipDenominationPanel } from "./components/ChipDenominationPanel";
import { IconKey } from "./components/IconKey";
import { PlayerDrawer } from "./components/PlayerDrawer";
import { PokerTable } from "./components/PokerTable";
import { SettlementPanel } from "./components/SettlementPanel";
import { TableSetupPanel } from "./components/TableSetupPanel";
import { TransactionForm } from "./components/TransactionForm";
import { TransactionTable } from "./components/TransactionTable";
import {
  buildPlayerSummaries,
  calculateBankSummary,
  calculateLedgerImbalanceCents,
  getSummaryByPlayerId
} from "./domain/ledger";
import { getCashOutOverview } from "./domain/chipCounts";
import type { Transaction } from "./domain/pokerTypes";
import { getLatestTransactionAction } from "./domain/recentTransactionAction";
import { filterSettlementSummariesForDisplay } from "./domain/settlement";
import { validateTransaction } from "./domain/validation";
import { gameReducer } from "./state/gameReducer";
import { loadGameState, saveGameState } from "./state/persistence";
import { createId } from "./state/seedGame";

export function App() {
  const [state, dispatch] = useReducer(gameReducer, undefined, loadGameState);
  const [mode, setMode] = useState<AppMode>("play");
  const [readOnly, setReadOnly] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [transactionDrawerOpen, setTransactionDrawerOpen] = useState(false);
  const [auditDrawerOpen, setAuditDrawerOpen] = useState(false);
  const [layoutEditing, setLayoutEditing] = useState(false);
  const [compactPlayerView, setCompactPlayerView] = useState(false);

  useEffect(() => {
    saveGameState(state);
  }, [state]);

  const activePlayers = useMemo(
    () =>
      state.players
        .filter((player) => player.isActive)
        .sort((a, b) => a.seatIndex - b.seatIndex),
    [state.players]
  );

  const playerSummaries = useMemo(
    () => buildPlayerSummaries(state.players, state.transactions),
    [state.players, state.transactions]
  );

  const summaryByPlayerId = useMemo(
    () => getSummaryByPlayerId(playerSummaries),
    [playerSummaries]
  );

  const bankSummary = useMemo(
    () => calculateBankSummary(state.transactions),
    [state.transactions]
  );

  const settlementSummaries = useMemo(
    () => filterSettlementSummariesForDisplay(state.players, playerSummaries),
    [playerSummaries, state.players]
  );

  const imbalanceCents = useMemo(
    () => calculateLedgerImbalanceCents(playerSummaries, bankSummary),
    [bankSummary, playerSummaries]
  );

  const cashOutOverview = useMemo(
    () =>
      getCashOutOverview(
        activePlayers,
        state.transactions,
        state.cashOutDrafts,
        state.settings.chipDenominations,
        bankSummary
      ),
    [activePlayers, bankSummary, state.cashOutDrafts, state.settings.chipDenominations, state.transactions]
  );

  const recentTransactionAction = useMemo(
    () => getLatestTransactionAction(state.transactions),
    [state.transactions]
  );

  function addTransaction(transaction: Transaction): boolean {
    if (readOnly) {
      setNotice("Read-only mode is on. Turn it off to record transactions.");
      return false;
    }

    const validationError = validateTransaction(transaction, state.players);
    if (validationError) {
      setNotice(validationError);
      return false;
    }

    if (
      transaction.type === "debt_coverage" &&
      transaction.coveredPlayerId
    ) {
      if (!settlementReady) {
        setNotice("Complete all cash-outs and balance the chip pool before covering debt.");
        return false;
      }

      const coveredSummary = summaryByPlayerId.get(transaction.coveredPlayerId);
      if (
        !coveredSummary ||
        coveredSummary.netCents >= 0 ||
        transaction.amountCents !== Math.abs(coveredSummary.netCents)
      ) {
        setNotice("Balances changed. Review the current full debt before recording coverage.");
        return false;
      }
    }

    dispatch({ type: "add_transaction", transaction });
    setNotice(null);
    return true;
  }

  function addDefaultBuyInToAll() {
    if (readOnly) {
      setNotice("Read-only mode is on. Turn it off to record transactions.");
      return;
    }

    const createdAt = new Date().toISOString();
    const transactions: Transaction[] = activePlayers.map((player) => ({
      id: createId("transaction"),
      type: "bank_buy_in",
      createdAt,
      amountCents: state.settings.defaultBuyInCents,
      toPlayerId: player.id,
      note: "Default buy-in"
    }));

    const validationError = transactions
      .map((transaction) => validateTransaction(transaction, state.players))
      .find((error) => error !== null);
    if (validationError) {
      setNotice(validationError);
      return;
    }

    for (const transaction of transactions) {
      dispatch({ type: "add_transaction", transaction });
    }
    setNotice(null);
  }

  const settlementReady =
    cashOutOverview.missingPlayers.length === 0 &&
    bankSummary.balanceCents === 0 &&
    imbalanceCents === 0;

  function changeMode(nextMode: AppMode) {
    setMode(nextMode);
    setTransactionDrawerOpen(false);
    setAuditDrawerOpen(false);
    setLayoutEditing(false);
  }

  const handleCompactPlayerViewChange = useCallback((compactView: boolean) => {
    setCompactPlayerView(compactView);
    if (compactView) setLayoutEditing(false);
  }, []);

  return (
    <>
      <AppShell
        cashOut={
          <CashOutMode
            bankSummary={bankSummary}
            denominations={state.settings.chipDenominations}
            dispatch={dispatch}
            drafts={state.cashOutDrafts}
            players={activePlayers}
            readOnly={readOnly}
            summaries={playerSummaries}
            transactions={state.transactions}
          />
        }
        layoutEditing={layoutEditing}
        layoutEditingDisabled={readOnly}
        hideLayoutEditing={compactPlayerView}
        mode={mode}
        onLayoutEditingChange={setLayoutEditing}
        onModeChange={changeMode}
        onUndoRecentTransaction={(action) =>
          dispatch({
            type: "undo_recent_transaction",
            action,
            requestedAt: new Date().toISOString()
          })
        }
        readOnly={readOnly}
        recentTransactionAction={recentTransactionAction}
        setup={
          <div className="setup-mode">
            <TableSetupPanel
              dispatch={dispatch}
              readOnly={readOnly}
              setReadOnly={setReadOnly}
              state={state}
            />
            <PlayerDrawer
              dispatch={dispatch}
              fastEntryDisabled={
                state.transactions.length > 0 || state.cashOutDrafts.length > 0
              }
              players={activePlayers}
              readOnly={readOnly}
              transactions={state.transactions}
            />
            <ChipDenominationPanel
              denominations={state.settings.chipDenominations}
              dispatch={dispatch}
              readOnly={readOnly}
            />
          </div>
        }
        play={
          <div className={`play-mode ${compactPlayerView ? "is-compact-player-view" : ""}`}>
            <section
              className="play-table-area"
              aria-label={compactPlayerView ? "Players" : "Poker table"}
            >
              {notice ? <div className="notice notice-warning">{notice}</div> : null}
              <PokerTable
                activePlayers={activePlayers}
                bankBalanceCents={bankSummary.balanceCents}
                defaultBuyInCents={state.settings.defaultBuyInCents}
                dispatch={dispatch}
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
              {!compactPlayerView ? <IconKey layoutEditing={layoutEditing} /> : null}
              <div className="play-actions">
                <button
                  className="text-button rail-action"
                  type="button"
                  onClick={() => setAuditDrawerOpen(true)}
                >
                  Transaction Audit
                </button>
                <button
                  className="text-button rail-action"
                  type="button"
                  disabled={readOnly || activePlayers.length === 0}
                  onClick={addDefaultBuyInToAll}
                >
                  Add default buy-in to all
                </button>
                <button
                  className="primary-button rail-action"
                  type="button"
                  disabled={readOnly}
                  onClick={() => setTransactionDrawerOpen(true)}
                >
                  Add transaction
                </button>
              </div>
            </aside>
          </div>
        }
        settle={
          <div className="settle-mode">
            <section className="settle-toolbar" aria-label="Settle controls">
              <BankSummaryPanel
                bankSummary={bankSummary}
                imbalanceCents={imbalanceCents}
                variant="compact"
              />
              <div className="settle-actions">
                <button
                  className="text-button"
                  type="button"
                  onClick={() => setAuditDrawerOpen(true)}
                >
                  Transaction Audit
                </button>
              </div>
            </section>
            {cashOutOverview.missingPlayers.length > 0 || bankSummary.balanceCents !== 0 ? (
              <div className="settle-warnings">
                {cashOutOverview.missingPlayers.length > 0 ? (
                  <div className="notice notice-warning">
                    Missing cash-outs: {cashOutOverview.missingPlayers.map((player) => player.name).join(", ")}.
                  </div>
                ) : null}
                {bankSummary.balanceCents !== 0 ? (
                  <div className="notice notice-warning">
                    The chip pool still has {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(bankSummary.balanceCents / 100)} remaining.
                  </div>
                ) : null}
              </div>
            ) : null}
            <SettlementPanel
              bankSummary={bankSummary}
              imbalanceCents={imbalanceCents}
              onAddTransaction={addTransaction}
              players={state.players}
              readOnly={readOnly}
              settlementReady={settlementReady}
              summaries={settlementSummaries}
            />
          </div>
        }
      />

      {transactionDrawerOpen ? (
        <div className="drawer-backdrop" role="presentation">
          <section
            className="drawer-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Add transaction"
          >
            <div className="drawer-heading">
              <h2>Transaction Entry</h2>
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
              bankBalanceCents={bankSummary.balanceCents}
              defaultBuyInCents={state.settings.defaultBuyInCents}
              onAddTransaction={(transaction) => {
                const added = addTransaction(transaction);
                if (added) {
                  setTransactionDrawerOpen(false);
                }
                return added;
              }}
              players={activePlayers}
              readOnly={readOnly}
              summaryByPlayerId={summaryByPlayerId}
            />
          </section>
        </div>
      ) : null}

      {auditDrawerOpen ? (
        <div className="drawer-backdrop" role="presentation">
          <section
            className="drawer-panel drawer-panel-wide"
            role="dialog"
            aria-modal="true"
            aria-label="Transaction audit"
          >
            <div className="drawer-heading">
              <h2>Transaction Audit</h2>
              <button
                className="icon-button"
                type="button"
                onClick={() => setAuditDrawerOpen(false)}
                title="Close"
              >
                <X size={17} />
              </button>
            </div>
            <TransactionTable
              dispatch={dispatch}
              players={state.players}
              readOnly={readOnly}
              transactions={state.transactions}
              variant="compact"
            />
          </section>
        </div>
      ) : null}
    </>
  );
}
