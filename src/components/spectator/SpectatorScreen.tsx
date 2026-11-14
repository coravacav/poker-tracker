import { Eye, Link2, LogOut, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { firstTransactionAtMs } from "../../domain/ledger";
import type { SpectatorRoomProjection } from "../../session/types";
import { BankSummaryPanel } from "../BankSummary";
import { ChipKey } from "../ChipKey";
import { CurrencyProvider } from "../CurrencyContext";
import { useLedgerOverview } from "../gameApp/useLedgerOverview";
import { PokerTable } from "../PokerTable";
import { SettlementPanel } from "../SettlementPanel";
import { SpectatorFeed } from "./SpectatorFeed";

type SpectatorScreenProps = {
  room: SpectatorRoomProjection | null;
  connected: boolean;
  error: string | null;
  onLeave: () => void;
};

type SpectatorView = "table" | "results";

// Watchers change nothing, so every table control is inert.
const ignoreAction = () => undefined;
const refuseTransaction = () => false;

/** The watch link: a live, read-only table, feed, chip key, and (once it is time) the results. */
export function SpectatorScreen({ room, connected, error, onLeave }: SpectatorScreenProps) {
  if (!room) {
    return (
      <main className="guest-join-page">
        <section className="panel guest-join-card">
          <p className="eyebrow">Poker Tracker watch link</p>
          {error ? (
            <>
              <WifiOff size={30} />
              <h1>{connected ? "Watch link unavailable" : "Reconnecting…"}</h1>
              <p>{error}</p>
            </>
          ) : (
            <h1>Opening the game…</h1>
          )}
          <button className="text-button" type="button" onClick={onLeave}>
            Back to Home
          </button>
        </section>
      </main>
    );
  }
  return <SpectatorGame room={room} connected={connected} error={error} onLeave={onLeave} />;
}

function SpectatorGame({
  room,
  connected,
  error,
  onLeave
}: SpectatorScreenProps & { room: SpectatorRoomProjection }) {
  const { state } = room;
  const {
    activePlayers,
    summaryByPlayerId,
    bankSummary,
    settlementSummaries,
    imbalanceCents,
    cashOutOverview,
    settlementReady
  } = useLedgerOverview(state);
  const ended = room.status !== "active";
  const resultsAvailable = ended || settlementReady;
  const [view, setView] = useState<SpectatorView>(() => (ended ? "results" : "table"));
  // When the host ends the game, the results are what watchers came for.
  useEffect(() => {
    if (ended) setView("results");
  }, [ended]);
  const activeView = resultsAvailable ? view : "table";
  const status = ended ? "Game ended" : connected ? "Spectating" : "Reconnecting";
  const showChipKey = state.settings.chipDenominations.length > 0;

  return (
    <CurrencyProvider currencyCode={state.settings.currencyCode}>
      <div className="app-shell spectator-shell">
        <header className="app-header">
          <div className="app-title">
            <p className="eyebrow">{ended ? "Watched game" : "Watching live"}</p>
            <h1 title={room.name}>{room.name}</h1>
          </div>
          <div className="spectator-session-controls">
            <span className="spectator-pill">
              {connected || ended ? <Eye size={15} aria-hidden="true" /> : <WifiOff size={15} aria-hidden="true" />}
              {status}
            </span>
            <button className="text-button" type="button" onClick={onLeave}>
              <LogOut size={15} /> Leave
            </button>
          </div>
          {resultsAvailable ? (
            <nav className="app-nav" aria-label="Watch views">
              <div className="mode-tabs">
                {(["table", "results"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={activeView === option ? "is-active" : ""}
                    aria-pressed={activeView === option}
                    onClick={() => setView(option)}
                  >
                    {option === "table" ? "Table" : "Results"}
                  </button>
                ))}
              </div>
            </nav>
          ) : null}
        </header>

        <main className={`app-main app-main-${activeView === "table" ? "play" : "settle"}`} aria-label="Watch view">
          {activeView === "results" ? (
            <div className="settle-mode spectator-results">
              {ended ? <div className="notice notice-info">The host ended this game.</div> : null}
              <SettlementPanel
                bankSummary={bankSummary}
                currencyCode={state.settings.currencyCode}
                gameName={state.settings.gameName}
                startedAtMs={firstTransactionAtMs(state.transactions)}
                hideActions
                imbalanceCents={imbalanceCents}
                onAddTransaction={refuseTransaction}
                players={state.players}
                readOnly
                settlementPins={state.settlementPins}
                settlementReady={settlementReady}
                summaries={settlementSummaries}
              />
            </div>
          ) : (
            <div className="play-mode spectator-play">
              <section className="play-table-area" aria-label="Poker table">
                {error ? <div className="notice notice-warning">{error}</div> : null}
                <PokerTable
                  activePlayers={activePlayers}
                  bankBalanceCents={bankSummary.balanceCents}
                  cashedOutPlayerIds={cashOutOverview.completedPlayerIds}
                  defaultBuyInCents={state.settings.defaultBuyInCents}
                  dispatch={ignoreAction}
                  hideActions
                  layoutEditing={false}
                  onAddTransaction={refuseTransaction}
                  readOnly
                  tableSeatPlacements={state.settings.tableSeatPlacements}
                  tableShape={state.settings.tableShape}
                  summaryByPlayerId={summaryByPlayerId}
                />
              </section>
              <aside className="play-rail spectator-rail" aria-label="Game details">
                <BankSummaryPanel bankSummary={bankSummary} imbalanceCents={imbalanceCents} variant="compact" />
                {showChipKey ? <ChipKey denominations={state.settings.chipDenominations} /> : null}
                <SpectatorFeed events={room.events} live={connected && !ended} />
                {!ended ? (
                  <p className="spectator-hint">
                    <Link2 size={16} aria-hidden="true" />
                    <span><strong>Playing tonight?</strong> Ask the host for the player link.</span>
                  </p>
                ) : null}
              </aside>
            </div>
          )}
        </main>
      </div>
    </CurrencyProvider>
  );
}
