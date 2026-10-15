import { useCallback, useState } from "react";
import type { Dispatch, ReactNode } from "react";
import { AppShell, type AppMode } from "./AppShell";
import { CashOutMode } from "./CashOutMode";
import { ChipDenominationPanel } from "./ChipDenominationPanel";
import { CurrencyProvider } from "./CurrencyContext";
import { PlayerDrawer } from "./PlayerDrawer";
import { SessionHistoryPanel } from "./SessionHistoryPanel";
import { SharedNotifications } from "./SharedNotifications";
import { TableSetupPanel } from "./TableSetupPanel";
import type { GameState, Transaction } from "../domain/pokerTypes";
import { validateTransaction } from "../domain/validation";
import type { RoomHistoryProjection, SharedActivity } from "../session/types";
import type { GameAction } from "../state/gameReducer";
import { createId } from "../state/seedGame";
import { AuditDrawer } from "./gameApp/AuditDrawer";
import { PlayMode } from "./gameApp/PlayMode";
import { SettleMode } from "./gameApp/SettleMode";
import { TransactionDrawer } from "./gameApp/TransactionDrawer";
import { useLedgerOverview } from "./gameApp/useLedgerOverview";

type GameAppProps = {
  state: GameState;
  dispatch: Dispatch<GameAction>;
  forcedReadOnly: boolean;
  guest: boolean;
  ledgerLabel: string;
  sessionControls?: ReactNode;
  sessionNotice: string | null;
  sharedActivity?: SharedActivity;
  onMarkNotificationsRead: () => void;
  onSubmitGuestTransaction: (transaction: Transaction) => void;
  roomHistory: RoomHistoryProjection[];
  initialMode: AppMode;
  onHome?: () => void;
};

export function GameApp({
  state,
  dispatch,
  forcedReadOnly,
  guest,
  ledgerLabel,
  onMarkNotificationsRead,
  onSubmitGuestTransaction,
  roomHistory,
  sessionControls,
  sessionNotice,
  sharedActivity,
  initialMode,
  onHome
}: GameAppProps) {
  const [mode, setMode] = useState<AppMode>(() => initialMode);
  const [manualReadOnly, setManualReadOnly] = useState(false);
  const readOnly = forcedReadOnly || manualReadOnly;
  const [notice, setNotice] = useState<string | null>(null);
  const [transactionDrawerOpen, setTransactionDrawerOpen] = useState(false);
  const [auditDrawerOpen, setAuditDrawerOpen] = useState(false);
  const [layoutEditing, setLayoutEditing] = useState(false);
  const [compactPlayerView, setCompactPlayerView] = useState(false);
  const {
    activePlayers,
    playerSummaries,
    summaryByPlayerId,
    bankSummary,
    settlementSummaries,
    imbalanceCents,
    cashOutOverview,
    recentTransactionAction,
    repeatableTransaction,
    settlementReady
  } = useLedgerOverview(state);

  function addTransaction(transaction: Transaction): boolean {
    if (readOnly) {
      setNotice(guest ? "Guests have a read-only view." : "Reconnect before changing the shared game.");
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
      setNotice(guest ? "Guests have a read-only view." : "Reconnect before changing the shared game.");
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

    dispatch({ type: "add_transactions", transactions });
    setNotice(null);
  }

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
    <CurrencyProvider currencyCode={state.settings.currencyCode}>
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
        guest={guest}
        ledgerLabel={ledgerLabel}
        notifications={
          sharedActivity ? (
            <SharedNotifications
              activity={sharedActivity}
              onMarkRead={() => void onMarkNotificationsRead()}
              players={state.players}
            />
          ) : null
        }
        layoutEditing={layoutEditing}
        layoutEditingDisabled={readOnly}
        hideLayoutEditing={compactPlayerView}
        mode={mode}
        onLayoutEditingChange={setLayoutEditing}
        onHome={onHome}
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
        sessionControls={sessionControls}
        setup={
          <div className="setup-mode">
            <TableSetupPanel
              dispatch={dispatch}
              readOnly={readOnly}
              setReadOnly={setManualReadOnly}
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
            <SessionHistoryPanel sharedRooms={roomHistory} />
          </div>
        }
        play={
          <PlayMode
            state={state}
            dispatch={dispatch}
            guest={guest}
            readOnly={readOnly}
            notice={notice}
            sessionNotice={sessionNotice}
            layoutEditing={layoutEditing}
            compactPlayerView={compactPlayerView}
            activePlayers={activePlayers}
            bankSummary={bankSummary}
            imbalanceCents={imbalanceCents}
            summaryByPlayerId={summaryByPlayerId}
            repeatableTransaction={repeatableTransaction}
            addTransaction={addTransaction}
            addDefaultBuyInToAll={addDefaultBuyInToAll}
            handleCompactPlayerViewChange={handleCompactPlayerViewChange}
            setAuditDrawerOpen={setAuditDrawerOpen}
            setTransactionDrawerOpen={setTransactionDrawerOpen}
          />
        }
        settle={
          <SettleMode
            state={state}
            dispatch={dispatch}
            guest={guest}
            readOnly={readOnly}
            bankSummary={bankSummary}
            imbalanceCents={imbalanceCents}
            cashOutOverview={cashOutOverview}
            settlementReady={settlementReady}
            settlementSummaries={settlementSummaries}
            addTransaction={addTransaction}
            setNotice={setNotice}
            setAuditDrawerOpen={setAuditDrawerOpen}
          />
        }
      />

      {transactionDrawerOpen ? (
        <TransactionDrawer
          state={state}
          guest={guest}
          readOnly={readOnly}
          activePlayers={activePlayers}
          bankSummary={bankSummary}
          summaryByPlayerId={summaryByPlayerId}
          addTransaction={addTransaction}
          onSubmitGuestTransaction={onSubmitGuestTransaction}
          setTransactionDrawerOpen={setTransactionDrawerOpen}
        />
      ) : null}

      {auditDrawerOpen ? (
        <AuditDrawer
          state={state}
          dispatch={dispatch}
          guest={guest}
          readOnly={readOnly}
          sharedActivity={sharedActivity}
          setAuditDrawerOpen={setAuditDrawerOpen}
        />
      ) : null}
    </CurrencyProvider>
  );
}
