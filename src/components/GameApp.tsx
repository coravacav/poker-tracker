import { useCallback, useState } from "react";
import type { Dispatch, ReactNode } from "react";
import { AppShell, type AppMode } from "./AppShell";
import { CurrencyProvider } from "./CurrencyContext";
import { LazyBoundary, lazyWithPreload } from "./lazyComponent";
import { SharedNotifications } from "./SharedNotifications";
import type { GameState, Transaction } from "../domain/pokerTypes";
import { formatCurrency } from "../domain/money";
import { buyInToAllConfirmation } from "../domain/quickEntry";
import { describeRecentTransactionAction } from "../domain/recentTransactionAction";
import { validateTransaction } from "../domain/validation";
import type { RoomHistoryProjection, SharedActivity } from "../session/types";
import type { GameAction } from "../state/gameReducer";
import { createId } from "../state/seedGame";
import { TransactionDrawer } from "./gameApp/TransactionDrawer";
import { useLedgerOverview } from "./gameApp/useLedgerOverview";

// Every mode and the audit drawer load as separate chunks, so Home paints without
// the table and drag code. Play is preloaded as soon as a game screen is coming
// (see preloadPlayMode); the rest once the browser is idle.
const PlayMode = lazyWithPreload(() => import("./gameApp/PlayMode").then((module) => module.PlayMode));
const SetupMode = lazyWithPreload(() => import("./gameApp/SetupMode").then((module) => module.SetupMode));
const CashOutMode = lazyWithPreload(() => import("./CashOutMode").then((module) => module.CashOutMode));
const SettleMode = lazyWithPreload(() => import("./gameApp/SettleMode").then((module) => module.SettleMode));
const AuditDrawer = lazyWithPreload(() => import("./gameApp/AuditDrawer").then((module) => module.AuditDrawer));

/** Loads every lazily split game surface so switching to it never waits. */
export function preloadGameApp(): Promise<unknown> {
  return Promise.all(
    [PlayMode, SetupMode, CashOutMode, SettleMode, AuditDrawer].map((surface) => surface.preload())
  );
}

/** Starts loading Play, the main screen of every game; safe to call repeatedly. */
export const preloadPlayMode = PlayMode.preload;

function modeFallback(label: string) {
  return <p className="muted" role="status">Loading {label}…</p>;
}

type GameAppProps = {
  state: GameState;
  dispatch: Dispatch<GameAction>;
  forcedReadOnly: boolean;
  guest: boolean;
  ledgerLabel: string;
  title?: string;
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
  title,
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

    const confirmation = buyInToAllConfirmation(
      activePlayers.map((player) => player.id),
      state.transactions,
      state.settings.defaultBuyInCents,
      (cents) => formatCurrency(cents, state.settings.currencyCode)
    );
    if (confirmation && !window.confirm(confirmation)) return;

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
          <LazyBoundary key="cash_out" fallback={modeFallback("Cash Out")}>
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
          </LazyBoundary>
        }
        guest={guest}
        ledgerLabel={ledgerLabel}
        title={title}
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
        recentTransactionLabel={
          recentTransactionAction
            ? describeRecentTransactionAction(
                recentTransactionAction,
                state.transactions,
                state.players,
                (cents) => formatCurrency(cents, state.settings.currencyCode)
              )
            : null
        }
        sessionControls={sessionControls}
        setup={
          <LazyBoundary key="setup" fallback={modeFallback("Setup")}>
            <SetupMode
              state={state}
              dispatch={dispatch}
              readOnly={readOnly}
              setReadOnly={setManualReadOnly}
              activePlayers={activePlayers}
              roomHistory={roomHistory}
            />
          </LazyBoundary>
        }
        play={
          <LazyBoundary key="play" fallback={modeFallback("Play")}>
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
              cashedOutPlayerIds={cashOutOverview.completedPlayerIds}
              imbalanceCents={imbalanceCents}
              summaryByPlayerId={summaryByPlayerId}
              repeatableTransaction={repeatableTransaction}
              addTransaction={addTransaction}
              addDefaultBuyInToAll={addDefaultBuyInToAll}
              handleCompactPlayerViewChange={handleCompactPlayerViewChange}
              setAuditDrawerOpen={setAuditDrawerOpen}
              setTransactionDrawerOpen={setTransactionDrawerOpen}
            />
          </LazyBoundary>
        }
        settle={
          <LazyBoundary key="settle" fallback={modeFallback("Settle")}>
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
          </LazyBoundary>
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
        <LazyBoundary fallback={null}>
          <AuditDrawer
            state={state}
            dispatch={dispatch}
            guest={guest}
            readOnly={readOnly}
            sharedActivity={sharedActivity}
            setAuditDrawerOpen={setAuditDrawerOpen}
          />
        </LazyBoundary>
      ) : null}
    </CurrencyProvider>
  );
}
