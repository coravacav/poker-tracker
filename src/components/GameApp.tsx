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
import type { GuestSeatControls } from "./gameApp/GuestSeatPrompt";
import { ChipsTab } from "./guestPlay/ChipsTab";
import { GuestTableTab } from "./guestPlay/GuestTableTab";
import { InboxTab, waitingOnMeCount } from "./guestPlay/InboxTab";
import type { ChipsDraft, PeerGuestControls } from "./guestPlay/types";
import { useNow } from "./guestPlay/useNow";
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
  /** A guest's own seat and the seats they could take (shared rooms that have seats). */
  guestSeat?: GuestSeatControls;
  /** A seated guest in a room where players confirm each other: Table · Chips · Inbox. */
  peerGuest?: PeerGuestControls;
  ledgerLabel: string;
  title?: string;
  sessionControls?: ReactNode;
  sessionNotice: string | null;
  sharedActivity?: SharedActivity;
  onMarkNotificationsRead: () => void;
  onSubmitGuestTransaction: (transaction: Transaction) => void;
  roomHistory: RoomHistoryProjection[];
  /** Turns off a hosted room's watch link from Player History's Shared rooms. */
  onTurnOffWatchLink?: (publicId: string) => Promise<void>;
  initialMode: AppMode;
  onHome?: () => void;
};

export function GameApp({
  state,
  dispatch,
  forcedReadOnly,
  guest,
  guestSeat,
  peerGuest,
  ledgerLabel,
  title,
  onMarkNotificationsRead,
  onSubmitGuestTransaction,
  roomHistory,
  onTurnOffWatchLink,
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
  // A seated guest's Chips draft (Edit & resend, or a shortcut from Table) and the note Inbox opens with.
  const [chipsDraft, setChipsDraft] = useState<{ key: number; draft: ChipsDraft } | null>(null);
  const [peerNotice, setPeerNotice] = useState<string | null>(null);
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

  const peerSeatPlayer = guest && peerGuest
    ? activePlayers.find((player) => player.id === peerGuest.seatPlayerId)
    : undefined;
  const peer = peerSeatPlayer && peerGuest ? { ...peerGuest, me: peerSeatPlayer } : null;
  const settleAvailable = settlementReady || (peer?.ended ?? false);
  const badgeNow = useNow((peer?.agreements.needsMe.length ?? 0) > 0);
  const inboxCount = peer ? waitingOnMeCount(peer.agreements, badgeNow) : 0;
  // Tabs that don't exist for this guest fall back to their Table / Play.
  const activeMode: AppMode = peer
    ? mode === "setup" || mode === "cash_out" || (mode === "settle" && !settleAvailable) ? "play" : mode
    : mode === "chips" || mode === "inbox" ? "play" : mode;

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
    setPeerNotice(null);
    setTransactionDrawerOpen(false);
    setAuditDrawerOpen(false);
    setLayoutEditing(false);
  }

  function openChips(draft: ChipsDraft) {
    setChipsDraft((current) => ({ key: (current?.key ?? 0) + 1, draft }));
    changeMode("chips");
  }

  async function sendProposal(
    proposal: Parameters<PeerGuestControls["onPropose"]>[0],
    draft: ChipsDraft
  ): Promise<boolean> {
    if (!peer) return false;
    const sent = await peer.onPropose(proposal);
    if (sent === null) return false;
    // Resending a bounced entry replaces it.
    if (draft.resendOf) void peer.onDismiss(draft.resendOf);
    const nameOf = (playerId: string | undefined) =>
      state.players.find((player) => player.id === playerId)?.name ?? "them";
    setChipsDraft(null);
    changeMode("inbox");
    setPeerNotice(
      proposal.kind === "bank"
        ? proposal.witnessPlayerId
          ? `Sent. Waiting on ${nameOf(proposal.witnessPlayerId)} to say they saw it.`
          : "Sent. Waiting for someone to say they saw it."
        : `Sent. Waiting on ${nameOf(proposal.counterpartyPlayerId)} to confirm.`
    );
    return true;
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
        guestTabs={peer ? { inboxCount, showSettle: settleAvailable } : undefined}
        chips={peer ? (
          <ChipsTab
            key={chipsDraft?.key ?? 0}
            me={peer.me}
            players={activePlayers}
            summaryByPlayerId={summaryByPlayerId}
            seats={peer.seats}
            defaultBuyInCents={state.settings.defaultBuyInCents}
            ended={peer.ended}
            notice={notice ?? sessionNotice}
            initialDraft={chipsDraft?.draft ?? null}
            onSend={sendProposal}
            onAskHost={() => setTransactionDrawerOpen(true)}
          />
        ) : null}
        inbox={peer ? (
          <InboxTab
            seatPlayerId={peer.me.id}
            agreements={peer.agreements}
            notice={peerNotice}
            error={sessionNotice}
            onAnswer={peer.onAnswer}
            onCancel={peer.onCancel}
            onDismiss={peer.onDismiss}
            onResend={(agreement) =>
              openChips({
                kind: agreement.kind,
                amountCents: agreement.amountCents,
                resendOf: agreement.id,
                ...(agreement.counterpartyPlayerId ? { counterpartyPlayerId: agreement.counterpartyPlayerId } : {}),
                ...(agreement.witnessPlayerId ? { witnessPlayerId: agreement.witnessPlayerId } : {})
              })
            }
          />
        ) : null}
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
        mode={activeMode}
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
              onTurnOffWatchLink={onTurnOffWatchLink}
            />
          </LazyBoundary>
        }
        play={peer ? (
          <GuestTableTab
            state={state}
            me={peer.me}
            notice={notice ?? sessionNotice}
            activePlayers={activePlayers}
            bankSummary={bankSummary}
            cashedOutPlayerIds={cashOutOverview.completedPlayerIds}
            imbalanceCents={imbalanceCents}
            summaryByPlayerId={summaryByPlayerId}
            settleAvailable={settleAvailable}
            waitingOnMe={inboxCount}
            events={sharedActivity?.events ?? []}
            live={!peer.ended}
            onOpenChips={(kind) => openChips({ kind })}
            onOpenInbox={() => changeMode("inbox")}
            onOpenSettle={() => changeMode("settle")}
            onOpenAudit={() => setAuditDrawerOpen(true)}
          />
        ) : (
          <LazyBoundary key="play" fallback={modeFallback("Play")}>
            <PlayMode
              state={state}
              dispatch={dispatch}
              guest={guest}
              guestSeat={guestSeat}
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
        )}
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
          defaultPlayerId={guest ? (guestSeat?.seatPlayerId ?? undefined) : undefined}
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
