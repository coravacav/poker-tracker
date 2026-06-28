import { X } from "lucide-react";
import { useEffect, useMemo, useReducer, useState } from "react";
import { AppShell, type AppMode } from "./components/AppShell";
import { BankSummaryPanel } from "./components/BankSummary";
import { CashOutPanel } from "./components/CashOutPanel";
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
  getSummaryByPlayerId,
  hasPlayerTransactions
} from "./domain/ledger";
import type { Transaction } from "./domain/pokerTypes";
import { filterSettlementSummariesForDisplay } from "./domain/settlement";
import { validateTransaction } from "./domain/validation";
import { gameReducer } from "./state/gameReducer";
import { loadGameState, saveGameState } from "./state/persistence";

export function App() {
  const [state, dispatch] = useReducer(gameReducer, undefined, loadGameState);
  const [mode, setMode] = useState<AppMode>("play");
  const [readOnly, setReadOnly] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [transactionDrawerOpen, setTransactionDrawerOpen] = useState(false);
  const [chipCountsDrawerOpen, setChipCountsDrawerOpen] = useState(false);
  const [auditDrawerOpen, setAuditDrawerOpen] = useState(false);
  const [layoutEditing, setLayoutEditing] = useState(false);

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

  const minimumPlayerCount = useMemo(
    () =>
      Math.max(
        1,
        state.players.filter((player) =>
          hasPlayerTransactions(player.id, state.transactions)
        ).length
      ),
    [state.players, state.transactions]
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

    dispatch({ type: "add_transaction", transaction });
    setNotice(null);
    return true;
  }

  function changeMode(nextMode: AppMode) {
    setMode(nextMode);
    setTransactionDrawerOpen(false);
    setChipCountsDrawerOpen(false);
    setAuditDrawerOpen(false);
    setLayoutEditing(false);
  }

  return (
    <>
      <AppShell
        layoutEditing={layoutEditing}
        layoutEditingDisabled={readOnly}
        mode={mode}
        onLayoutEditingChange={setLayoutEditing}
        onModeChange={changeMode}
        setup={
          <div className="setup-mode">
            <TableSetupPanel
              activePlayerCount={activePlayers.length}
              dispatch={dispatch}
              minimumPlayerCount={minimumPlayerCount}
              readOnly={readOnly}
              setReadOnly={setReadOnly}
              state={state}
            />
            <PlayerDrawer
              dispatch={dispatch}
              players={activePlayers}
              readOnly={readOnly}
              transactions={state.transactions}
            />
          </div>
        }
        play={
          <div className="play-mode">
            <section className="play-table-area" aria-label="Poker table">
              {notice ? <div className="notice notice-warning">{notice}</div> : null}
              <PokerTable
                activePlayers={activePlayers}
                defaultBuyInCents={state.settings.defaultBuyInCents}
                dispatch={dispatch}
                onAddTransaction={addTransaction}
                layoutEditing={layoutEditing}
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
              <IconKey />
              <button
                className="primary-button rail-action"
                type="button"
                disabled={readOnly}
                onClick={() => setTransactionDrawerOpen(true)}
              >
                Add transaction
              </button>
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
                  className="primary-button"
                  type="button"
                  onClick={() => setChipCountsDrawerOpen(true)}
                >
                  Chip Counts
                </button>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => setAuditDrawerOpen(true)}
                >
                  Transaction Audit
                </button>
              </div>
            </section>
            <SettlementPanel
              bankSummary={bankSummary}
              imbalanceCents={imbalanceCents}
              players={state.players}
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

      {chipCountsDrawerOpen ? (
        <div className="drawer-backdrop" role="presentation">
          <section
            className="drawer-panel drawer-panel-wide"
            role="dialog"
            aria-modal="true"
            aria-label="Chip counts"
          >
            <div className="drawer-heading">
              <h2>Chip Counts</h2>
              <button
                className="icon-button"
                type="button"
                onClick={() => setChipCountsDrawerOpen(false)}
                title="Close"
              >
                <X size={17} />
              </button>
            </div>
            <CashOutPanel
              onAddTransaction={addTransaction}
              players={activePlayers}
              summaries={playerSummaries}
              transactions={state.transactions}
              readOnly={readOnly}
              variant="drawer"
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
