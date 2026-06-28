import type { ReactNode } from "react";

export type AppMode = "setup" | "play" | "settle";

type AppShellProps = {
  mode: AppMode;
  onModeChange: (mode: AppMode) => void;
  play: ReactNode;
  setup: ReactNode;
  settle: ReactNode;
};

const modeLabels: Array<{ mode: AppMode; label: string }> = [
  { mode: "setup", label: "Setup" },
  { mode: "play", label: "Play" },
  { mode: "settle", label: "Settle" }
];

export function AppShell({
  mode,
  onModeChange,
  play,
  setup,
  settle
}: AppShellProps) {
  const activeView = mode === "setup" ? setup : mode === "settle" ? settle : play;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Local ledger</p>
          <h1>Poker Tracker</h1>
        </div>
        <nav className="mode-tabs" aria-label="Poker tracker modes">
          {modeLabels.map((option) => (
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
        </nav>
      </header>

      <main className={`app-main app-main-${mode}`} aria-label={`${mode} mode`}>
        {activeView}
      </main>
    </div>
  );
}
