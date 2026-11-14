import { Check, Radio } from "lucide-react";
import type { SharedAuditEvent } from "../../session/types";

/** Feed entries shown; the server sends a few more, newest first. */
const FEED_LENGTH = 20;

function eventTime(createdAt: number): string {
  return new Date(createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/**
 * Who made an entry, when it was not simply the host: an approved guest
 * request now, and later the players who confirmed it ("Maya · confirmed by Jon").
 */
function eventDetail(event: SharedAuditEvent): string | null {
  if (event.actorLabel === "Host") return null;
  if (event.actorLabel === "Host-approved guest request") return "Approved by the host";
  return event.actorLabel;
}

/** The latest ledger entries, live: buy-ins, transfers, cash-outs, and corrections. */
export function SpectatorFeed({ events, live }: { events: SharedAuditEvent[]; live: boolean }) {
  const entries = events.filter((event) => event.kind !== "game").slice(0, FEED_LENGTH);

  return (
    <section className="panel spectator-feed" aria-label="Live feed">
      <div className="spectator-feed-heading">
        <h2>Recent</h2>
        {live ? (
          <span className="spectator-live">
            <Radio size={14} aria-hidden="true" /> Live
          </span>
        ) : null}
      </div>
      {entries.length === 0 ? (
        <p className="muted">Buy-ins and cash-outs show up here as they happen.</p>
      ) : (
        <ol className="spectator-feed-list">
          {entries.map((event) => {
            const detail = eventDetail(event);
            return (
              <li key={event.id} className={event.kind === "correction" ? "is-correction" : undefined}>
                <span className="spectator-feed-mark" aria-hidden="true">
                  <Check size={12} strokeWidth={3} />
                </span>
                <span className="spectator-feed-text">
                  <span>{event.summary}</span>
                  {detail ? <span className="muted">{detail}</span> : null}
                </span>
                <time dateTime={new Date(event.createdAt).toISOString()}>{eventTime(event.createdAt)}</time>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
