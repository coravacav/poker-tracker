import { BarChart3 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { formatCurrency } from "../domain/money";
import {
  buildPlayerHistoryStats,
  GAME_ARCHIVE_CHANGED_EVENT,
  loadArchivedGames
} from "../domain/sessionHistory";
import type { RoomHistoryProjection } from "../session/types";
import { buildPlayerSummaries } from "../domain/ledger";

export function SessionHistoryPanel({ sharedRooms = [] }: { sharedRooms?: RoomHistoryProjection[] }) {
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
      <div className="shared-room-history">
        <h3>Shared rooms</h3>
        {sharedRooms.length === 0 ? (
          <p className="muted">Rooms you host or join on this device will remain available here.</p>
        ) : sharedRooms.map((room) => {
          const summaries = buildPlayerSummaries(room.state.players, room.state.transactions);
          return (
            <details key={`${room.role}:${room.publicId}`}>
              <summary>
                <strong>{room.name}</strong>
                <span>{room.role === "host" ? "Hosted" : `Joined as ${room.displayName ?? "guest"}`}</span>
                <span>{room.status}</span>
                <time dateTime={new Date(room.createdAt).toISOString()}>{new Date(room.createdAt).toLocaleDateString()}</time>
              </summary>
              <div className="shared-room-results">
                {summaries.map((summary) => (
                  <span key={summary.playerId}>
                    {room.state.players.find((player) => player.id === summary.playerId)?.name ?? "Player"}
                    <strong className={summary.netCents >= 0 ? "positive" : "negative"}>{formatCurrency(summary.netCents)}</strong>
                  </span>
                ))}
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}
