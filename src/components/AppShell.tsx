import { Coins, HandCoins, Home, Inbox, Spade, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  RECENT_TRANSACTION_UNDO_WINDOW_MS,
  isRecentTransactionAction
} from "../domain/recentTransactionAction";
import type { RecentTransactionAction } from "../domain/recentTransactionAction";
import { PwaControls } from "./PwaControls";

/** "chips" and "inbox" are a seated guest's tabs when players confirm each other ("play" is their Table). */
export type AppMode = "setup" | "play" | "cash_out" | "settle" | "chips" | "inbox";

/** A seated guest's Table · Chips · Inbox tabs (plus Settle once there is something to settle). */
export type GuestTabs = {
  /** Entries waiting on this guest, counted on Inbox. */
  inboxCount: number;
  showSettle: boolean;
};

type AppShellProps = {
  hideLayoutEditing?: boolean;
  layoutEditing: boolean;
  layoutEditingDisabled: boolean;
  mode: AppMode;
  onLayoutEditingChange: (layoutEditing: boolean) => void;
  onHome?: () => void;
  onModeChange: (mode: AppMode) => void;
  onUndoRecentTransaction: (action: RecentTransactionAction) => void;
  readOnly: boolean;
  recentTransactionAction: RecentTransactionAction | null;
  /** What Undo would reverse, shown beside it where Undo is a snackbar (phones, tablets in portrait, short landscape screens). */
  recentTransactionLabel?: string | null;
  guest?: boolean;
  /** Replaces a guest's Play and Settle tabs with Table · Chips · Inbox. */
  guestTabs?: GuestTabs;
  ledgerLabel?: string;
  /** The header's title; shared rooms show the game's name so hosts and guests can tell rooms apart. */
  title?: string;
  notifications?: ReactNode;
  sessionControls?: ReactNode;
  cashOut: ReactNode;
  play: ReactNode;
  setup: ReactNode;
  settle: ReactNode;
  chips?: ReactNode;
  inbox?: ReactNode;
};

const modeLabels: Array<{ mode: AppMode; label: string }> = [
  { mode: "setup", label: "Setup" },
  { mode: "play", label: "Play" },
  { mode: "cash_out", label: "Cash Out" },
  { mode: "settle", label: "Settle" }
];

type RecentTransactionUndoButtonProps = {
  action: RecentTransactionAction;
  label?: string | null;
  onUndo: (action: RecentTransactionAction) => void;
  readOnly: boolean;
};

function GuestTabButtons({
  mode,
  tabs,
  onModeChange
}: {
  mode: AppMode;
  tabs: GuestTabs;
  onModeChange: (mode: AppMode) => void;
}) {
  const options = [
    { mode: "play" as const, label: "Table", Icon: Spade },
    { mode: "chips" as const, label: "Chips", Icon: Coins },
    { mode: "inbox" as const, label: "Inbox", Icon: Inbox },
    ...(tabs.showSettle ? [{ mode: "settle" as const, label: "Settle", Icon: HandCoins }] : [])
  ];
  return (
    <div className={`mode-tabs guest-tabs ${tabs.showSettle ? "has-settle" : ""}`}>
      {options.map(({ mode: option, label, Icon }) => {
        const count = option === "inbox" ? tabs.inboxCount : 0;
        return (
          <button
            key={option}
            type="button"
            className={mode === option ? "is-active" : ""}
            aria-current={mode === option ? "page" : undefined}
            aria-label={count > 0 ? `${label}, ${count} waiting` : undefined}
            onClick={() => onModeChange(option)}
          >
            <span className="guest-tab-icon" aria-hidden="true">
              <Icon size={20} />
              {count > 0 ? <strong className="notification-count">{count}</strong> : null}
            </span>
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}

function RecentTransactionUndoButton({
  action,
  label,
  onUndo,
  readOnly
}: RecentTransactionUndoButtonProps) {
  const [available, setAvailable] = useState(() =>
    isRecentTransactionAction(action, Date.now())
  );

  useEffect(() => {
    const nowMs = Date.now();
    if (!isRecentTransactionAction(action, nowMs)) {
      setAvailable(false);
      return;
    }

    const remainingMs =
      Date.parse(action.occurredAt) + RECENT_TRANSACTION_UNDO_WINDOW_MS - nowMs;
    setAvailable(true);

    const timeout = window.setTimeout(() => setAvailable(false), remainingMs);
    return () => window.clearTimeout(timeout);
  }, [action]);

  if (!available || readOnly) {
    return null;
  }

  return (
    <button
      className="undo-transaction-nav-button"
      type="button"
      aria-label="Undo recent transaction action"
      title={label ? `Undo: ${label}` : "Undo recent transaction action"}
      onClick={() => {
        setAvailable(false);
        onUndo(action);
      }}
    >
      {label ? <span className="undo-transaction-label">{label}</span> : null}
      <span className="undo-transaction-action">
        <Undo2 size={16} />
        Undo
      </span>
    </button>
  );
}

export function AppShell({
  cashOut,
  chips,
  guest = false,
  guestTabs,
  inbox,
  ledgerLabel = "Local ledger",
  title,
  notifications,
  hideLayoutEditing = false,
  layoutEditing,
  layoutEditingDisabled,
  mode,
  onLayoutEditingChange,
  onHome,
  onModeChange,
  onUndoRecentTransaction,
  play,
  readOnly,
  recentTransactionAction,
  recentTransactionLabel,
  sessionControls,
  setup,
  settle
}: AppShellProps) {
  const activeView =
    mode === "setup"
      ? setup
      : mode === "cash_out"
        ? cashOut
        : mode === "settle"
          ? settle
          : mode === "chips"
            ? chips
            : mode === "inbox"
              ? inbox
              : play;

  return (
    <div className={`app-shell ${guestTabs ? "has-guest-tabs" : ""}`}>
      <header className="app-header">
        <div className="app-title">
          <p className="eyebrow">{ledgerLabel}</p>
          <h1 title={title}>{title ?? "Poker Tracker"}</h1>
        </div>
        {onHome ? (
          <button className="text-button home-button" type="button" aria-label="Home" onClick={onHome}>
            <Home size={16} /> <span className="home-button-label">Home</span>
          </button>
        ) : null}
        {sessionControls}
        <PwaControls />
        {notifications}
        <nav className="app-nav" aria-label="Poker tracker modes">
          {mode === "play" && !hideLayoutEditing && !guest ? (
            <button
              type="button"
              className={`layout-edit-nav-button ${layoutEditing ? "is-active" : ""}`}
              aria-pressed={layoutEditing}
              disabled={layoutEditingDisabled}
              onClick={() => onLayoutEditingChange(!layoutEditing)}
            >
              Edit layout
            </button>
          ) : null}
          {recentTransactionAction && !guest ? (
            <RecentTransactionUndoButton
              key={`${recentTransactionAction.kind}:${recentTransactionAction.transactionId}:${recentTransactionAction.occurredAt}`}
              action={recentTransactionAction}
              label={recentTransactionLabel}
              onUndo={onUndoRecentTransaction}
              readOnly={readOnly}
            />
          ) : null}
          {guestTabs ? (
            <GuestTabButtons mode={mode} tabs={guestTabs} onModeChange={onModeChange} />
          ) : <div className="mode-tabs">
            {modeLabels.filter((option) => !guest || option.mode === "play" || option.mode === "settle").map((option) => (
              <button
                key={option.mode}
                type="button"
                className={mode === option.mode ? "is-active" : ""}
                aria-pressed={mode === option.mode}
                onClick={() => onModeChange(option.mode)}
              >
                {option.label}
              </button>
            ))}
          </div>}
        </nav>
      </header>

      <main className={`app-main app-main-${mode}`} aria-label={`${mode} mode`}>
        {activeView}
      </main>
    </div>
  );
}
