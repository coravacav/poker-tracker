import { BarChart3 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { formatCurrency } from "../domain/money";
import {
  buildPlayerHistoryStats,
  GAME_ARCHIVE_CHANGED_EVENT,
  loadArchivedGames
} from "../domain/sessionHistory";

export function SessionHistoryPanel() {
  const [games, setGames] = useState(loadArchivedGames);
  useEffect(() => {
    const refresh = () => setGames(loadArchivedGames());
    window.addEventListener(GAME_ARCHIVE_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(GAME_ARCHIVE_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  const stats = useMemo(() => buildPlayerHistoryStats(games), [games]);

  return (
    <section className="panel session-history-panel" aria-label="Session history">
      <div className="panel-heading">
        <div><p className="eyebrow">Across poker nights</p><h2>Player History</h2></div>
        <BarChart3 size={20} />
      </div>
      {games.length === 0 ? (
        <p className="muted">Completed games appear here after you archive and start a new game.</p>
      ) : (
        <>
          <p className="muted">{games.length} archived {games.length === 1 ? "game" : "games"}</p>
          <div className="history-stat-list">
            {stats.map((stat) => (
              <div className="history-stat-row" key={stat.name.toLocaleLowerCase()}>
                <strong>{stat.name}</strong>
                <span>{stat.games} games</span>
                <span>Avg {formatCurrency(stat.averageNetCents)}</span>
                <strong className={stat.totalNetCents >= 0 ? "positive" : "negative"}>
                  {formatCurrency(stat.totalNetCents)}
                </strong>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
