import { useEffect, useMemo, useReducer, useState } from "react";
import { AppShell } from "./components/AppShell";
import { BankSummaryPanel } from "./components/BankSummary";
import { CashOutPanel } from "./components/CashOutPanel";
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
  const [readOnly, setReadOnly] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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

  return (
    <AppShell
      setup={
        <TableSetupPanel
          activePlayerCount={activePlayers.length}
          dispatch={dispatch}
          minimumPlayerCount={minimumPlayerCount}
          readOnly={readOnly}
          setReadOnly={setReadOnly}
          state={state}
        />
      }
      table={
        <PokerTable
          activePlayers={activePlayers}
          defaultBuyInCents={state.settings.defaultBuyInCents}
          dispatch={dispatch}
          onAddTransaction={addTransaction}
          readOnly={readOnly}
          seatLayout={state.settings.tableSeatLayout ?? "top_bottom"}
          summaryByPlayerId={summaryByPlayerId}
        />
      }
      players={
        <PlayerDrawer
          dispatch={dispatch}
          players={activePlayers}
          readOnly={readOnly}
          transactions={state.transactions}
        />
      }
      bank={
        <BankSummaryPanel
          bankSummary={bankSummary}
          imbalanceCents={imbalanceCents}
        />
      }
      transactions={
        <>
          {notice ? <div className="notice notice-warning">{notice}</div> : null}
          <TransactionForm
            defaultBuyInCents={state.settings.defaultBuyInCents}
            onAddTransaction={addTransaction}
            players={activePlayers}
            readOnly={readOnly}
            summaryByPlayerId={summaryByPlayerId}
          />
          <TransactionTable
            dispatch={dispatch}
            players={state.players}
            readOnly={readOnly}
            transactions={state.transactions}
          />
        </>
      }
      cashOut={
        <CashOutPanel
          onAddTransaction={addTransaction}
          players={activePlayers}
          summaries={playerSummaries}
          transactions={state.transactions}
          readOnly={readOnly}
        />
      }
      settlement={
        <SettlementPanel
          bankSummary={bankSummary}
          imbalanceCents={imbalanceCents}
          players={state.players}
          summaries={settlementSummaries}
        />
      }
    />
  );
}
