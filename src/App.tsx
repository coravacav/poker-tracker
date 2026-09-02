import { X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import type { Dispatch, ReactNode } from "react";
import { AppShell, type AppMode } from "./components/AppShell";
import { BankSummaryPanel } from "./components/BankSummary";
import { CashOutMode } from "./components/CashOutMode";
import { ChipDenominationPanel } from "./components/ChipDenominationPanel";
import { IconKey } from "./components/IconKey";
import { PlayerDrawer } from "./components/PlayerDrawer";
import { PokerTable } from "./components/PokerTable";
import { SettlementPanel } from "./components/SettlementPanel";
import { SharedNotifications } from "./components/SharedNotifications";
import { TableSetupPanel } from "./components/TableSetupPanel";
import { TransactionForm } from "./components/TransactionForm";
import { TransactionTable } from "./components/TransactionTable";
import { GuestJoinScreen } from "./components/GuestJoinScreen";
import {
  GuestSessionControls,
  HostSharingControls,
  LocalShareButton
} from "./components/SharingControls";
import {
  buildPlayerSummaries,
  calculateBankSummary,
  calculateLedgerImbalanceCents,
  getSummaryByPlayerId
} from "./domain/ledger";
import { getCashOutOverview } from "./domain/chipCounts";
import type { GameState, Transaction } from "./domain/pokerTypes";
import { getLatestTransactionAction } from "./domain/recentTransactionAction";
import { filterSettlementSummariesForDisplay } from "./domain/settlement";
import { validateTransaction } from "./domain/validation";
import type { GameAction } from "./state/gameReducer";
import { createId } from "./state/seedGame";
import { useGameSession } from "./session/useGameSession";
import type { RoomTransport, SharedActivity } from "./session/types";

export function App({ roomTransport }: { roomTransport?: RoomTransport } = {}) {
  const gameSession = useGameSession(roomTransport);
  const { session } = gameSession;

  if (session.mode === "joining") {
    return (
      <GuestJoinScreen
        error={session.error}
        joining={session.joining}
        onCancel={gameSession.dismissInvite}
        onJoin={(displayName) => void gameSession.joinGame(displayName)}
        roomName={session.preview.name}
        status={session.preview.status}
      />
    );
  }

  if (session.mode === "invalid_invite") {
    return (
      <GuestJoinScreen
        error={session.message}
        joining={false}
        onCancel={gameSession.dismissInvite}
        onJoin={() => undefined}
        status="invalid"
      />
    );
  }

  if (session.mode === "guest" && !session.room) {
    return (
      <GuestJoinScreen
        error={session.error}
        joining={false}
        onCancel={gameSession.leaveGuest}
        onJoin={() => undefined}
        status={session.error ? (session.connected ? "invalid" : "reconnecting") : "loading"}
      />
    );
  }

  let sessionControls: ReactNode;
  let sessionNotice: string | null = null;
  if (session.mode === "local") {
    sessionControls = <LocalShareButton onShare={() => void gameSession.shareGame()} />;
    sessionNotice = session.notice;
  } else if (session.mode === "creating_room") {
    sessionControls = <span className="session-status">Creating room…</span>;
    sessionNotice = session.error;
  } else if (session.mode === "guest") {
    sessionControls = (
      <GuestSessionControls
        connected={session.connected}
        displayName={session.credentials.displayName}
        ended={session.room?.status !== "active"}
        onLeave={gameSession.leaveGuest}
      />
    );
    sessionNotice = session.room?.status === "ended" ? "The host ended this shared session." : session.error;
  } else if (session.recovery) {
    sessionControls = (
      <HostSharingControls
        connected={session.connected}
        error={session.error}
        onClaimHost={() => void gameSession.claimHost()}
        onEnd={() => void gameSession.endSharing()}
        onRetryRecovery={gameSession.retryRecovery}
        onDecideGuestTransaction={(requestId, decision) =>
          void gameSession.decideGuestTransaction(requestId, decision)
        }
        pending={session.pending}
        recovery={session.recovery}
        recoveryRequired={session.mode === "recovery_required"}
        room={session.room}
      />
    );
    sessionNotice = session.error;
  }

  const sharedActivity: SharedActivity | undefined =
    (session.mode === "guest" ||
      session.mode === "hosting" ||
      session.mode === "ending" ||
      session.mode === "recovery_required")
      ? session.room?.activity
      : undefined;

  return (
    <GameApp
      dispatch={gameSession.dispatch}
      forcedReadOnly={gameSession.forcedReadOnly}
      guest={gameSession.isGuest}
      ledgerLabel={
        gameSession.isGuest
          ? "Shared read-only ledger"
          : session.mode === "local"
            ? "Local ledger"
            : "Shared host ledger"
      }
      sessionControls={sessionControls}
      sessionNotice={sessionNotice}
      sharedActivity={sharedActivity}
      onMarkNotificationsRead={gameSession.markNotificationsRead}
      onSubmitGuestTransaction={(transaction) =>
        void gameSession.submitGuestTransaction(transaction)
      }
      state={gameSession.state}
    />
  );
}

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
};

function GameApp({
  state,
  dispatch,
  forcedReadOnly,
  guest,
  ledgerLabel,
  onMarkNotificationsRead,
  onSubmitGuestTransaction,
  sessionControls,
  sessionNotice,
  sharedActivity
}: GameAppProps) {
  const [mode, setMode] = useState<AppMode>("play");
  const [manualReadOnly, setManualReadOnly] = useState(false);
  const readOnly = forcedReadOnly || manualReadOnly;
  const [notice, setNotice] = useState<string | null>(null);
  const [transactionDrawerOpen, setTransactionDrawerOpen] = useState(false);
  const [auditDrawerOpen, setAuditDrawerOpen] = useState(false);
  const [layoutEditing, setLayoutEditing] = useState(false);
  const [compactPlayerView, setCompactPlayerView] = useState(false);

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

  const settlementReady =
    cashOutOverview.cashOutsCompleteForSettlement &&
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
          </div>
        }
        play={
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
                    The chip pool still has {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(bankSummary.balanceCents / 100)} remaining.
                  </div>
                ) : null}
              </div>
            ) : null}
            <SettlementPanel
              bankSummary={bankSummary}
              gameName={state.settings.gameName}
              hideActions={guest}
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
              hideActions={guest}
              players={state.players}
              readOnly={readOnly}
              sharedEvents={sharedActivity?.events}
              transactions={state.transactions}
              variant="compact"
            />
          </section>
        </div>
      ) : null}
    </>
  );
}
