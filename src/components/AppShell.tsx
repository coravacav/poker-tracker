import { Home, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  RECENT_TRANSACTION_UNDO_WINDOW_MS,
  isRecentTransactionAction
} from "../domain/recentTransactionAction";
import type { RecentTransactionAction } from "../domain/recentTransactionAction";
import { PwaControls } from "./PwaControls";

export type AppMode = "setup" | "play" | "cash_out" | "settle";

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
  /** What Undo would reverse, shown beside it on phones. */
  recentTransactionLabel?: string | null;
  guest?: boolean;
  ledgerLabel?: string;
  /** The header's title; shared rooms show the game's name so hosts and guests can tell rooms apart. */
  title?: string;
  notifications?: ReactNode;
  sessionControls?: ReactNode;
  cashOut: ReactNode;
  play: ReactNode;
  setup: ReactNode;
  settle: ReactNode;
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
  guest = false,
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
    mode === "setup" ? setup : mode === "cash_out" ? cashOut : mode === "settle" ? settle : play;

  return (
    <div className="app-shell">
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
          <div className="mode-tabs">
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
          </div>
        </nav>
      </header>

      <main className={`app-main app-main-${mode}`} aria-label={`${mode} mode`}>
        {activeView}
      </main>
    </div>
  );
}
