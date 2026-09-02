import { Play, Plus, Spade } from "lucide-react";
import type { GameState } from "../domain/pokerTypes";
import type { LocalEntryReason } from "../session/localEntry";

type StartPageProps = {
  entry: {
    reason: LocalEntryReason;
    savedGame: GameState | null;
    error?: string;
  };
  onContinue: () => void;
  onStartNew: () => void;
};

function formatDate(value: string | undefined): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(timestamp);
}

function latestActivity(state: GameState): string | null {
  const timestamps = state.transactions
    .map((transaction) => Date.parse(transaction.createdAt))
    .filter((timestamp) => Number.isFinite(timestamp));
  const createdAt = Date.parse(state.settings.createdAt);
  if (Number.isFinite(createdAt)) timestamps.push(createdAt);
  if (timestamps.length === 0) return null;
  return formatDate(new Date(Math.max(...timestamps)).toISOString());
}

export function StartPage({ entry, onContinue, onStartNew }: StartPageProps) {
  const savedGame = entry.savedGame;
  const gameName = savedGame?.settings.gameName.trim() || "Poker Night";
  const activePlayerCount = savedGame?.players.filter((player) => player.isActive).length ?? 0;
  const activity = savedGame ? latestActivity(savedGame) : null;

  return (
    <main className="start-page">
      <section className="panel start-card" aria-labelledby="start-page-title">
        <Spade size={34} aria-hidden="true" />
        <p className="eyebrow">Poker Tracker</p>
        <h1 id="start-page-title">
          {savedGame ? "Welcome back" : "Ready for poker night?"}
        </h1>
        <p className="start-intro">
          {savedGame
            ? "Your local game is waiting. Pick up where you left off or start with a clean table."
            : "Set up a local ledger for your next game. Your game stays on this device and works offline."}
        </p>

        {savedGame ? (
          <div className="start-game-summary" aria-label="Saved game summary">
            <div className="start-game-summary-heading">
              <div>
                <p className="eyebrow">Saved game</p>
                <h2>{gameName}</h2>
              </div>
              <Play size={22} aria-hidden="true" />
            </div>
            <dl className="start-game-metrics">
              <div>
                <dt>Players</dt>
                <dd>{activePlayerCount}</dd>
              </div>
              <div>
                <dt>Entries</dt>
                <dd>{savedGame.transactions.length}</dd>
              </div>
              <div>
                <dt>Last activity</dt>
                <dd>{activity ?? "Not available"}</dd>
              </div>
            </dl>
          </div>
        ) : null}

        {entry.error ? <div className="notice notice-warning">{entry.error}</div> : null}

        <div className="start-actions">
          {savedGame ? (
            <button className="primary-button" type="button" onClick={onContinue}>
              <Play size={18} aria-hidden="true" />
              Continue {gameName}
            </button>
          ) : null}
          <button
            className={savedGame ? "start-new-button" : "primary-button"}
            type="button"
            onClick={onStartNew}
          >
            <Plus size={18} aria-hidden="true" />
            Start new game
          </button>
        </div>

        <p className="start-footnote">
          {savedGame
            ? "Games with transactions are saved to Player History when you start fresh."
            : "No account or internet connection required."}
        </p>
      </section>
    </main>
  );
}
