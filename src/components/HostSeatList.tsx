import { useState } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import type { HostSeat } from "../session/types";

/** Marker for "I'm not playing" in the host-seat picker. */
const NOT_PLAYING = "__not_playing__";

/**
 * The share dialog's Seats list: which phone holds each active seat (with
 * Release and Move), and which seat is the host's own.
 */
export function HostSeatList({
  seats,
  hostPlayerId,
  onReleaseSeat,
  onAssignSeat,
  onSetHostPlayer
}: {
  seats: HostSeat[];
  hostPlayerId: string | null;
  onReleaseSeat: (guestId: Id<"roomGuests">) => void;
  onAssignSeat: (guestId: Id<"roomGuests">, playerId: string) => void;
  onSetHostPlayer: (playerId: string | null) => void;
}) {
  const [choosingHostSeat, setChoosingHostSeat] = useState(false);
  const [notPlaying, setNotPlaying] = useState(false);
  if (seats.length === 0) return null;
  const phones = seats.filter((seat) => seat.guest !== null).length;
  const openSeats = seats.filter((seat) => !seat.guest && !seat.isHost);
  const showHostPrompt = choosingHostSeat || (hostPlayerId === null && !notPlaying);

  return (
    <section className="host-seat-list" aria-labelledby="host-seats-title">
      <div className="host-seat-heading">
        <h3 id="host-seats-title">Seats</h3>
        <span className="muted">
          {phones} {phones === 1 ? "phone" : "phones"} joined
        </span>
      </div>
      {showHostPrompt ? (
        <div className="host-seat-prompt">
          <span id="host-seat-prompt-label">Which seat is yours?</span>
          <select
            aria-label="Your seat"
            aria-describedby="host-seat-prompt-label"
            value=""
            onChange={(event) => {
              const value = event.currentTarget.value;
              setChoosingHostSeat(false);
              if (value === NOT_PLAYING) {
                setNotPlaying(true);
                if (hostPlayerId !== null) onSetHostPlayer(null);
              } else if (value) {
                onSetHostPlayer(value);
              }
            }}
          >
            <option value="" disabled>
              This is me…
            </option>
            {openSeats.map((seat) => (
              <option key={seat.playerId} value={seat.playerId}>
                {seat.name}
              </option>
            ))}
            <option value={NOT_PLAYING}>I’m not playing</option>
          </select>
        </div>
      ) : null}
      <ul>
        {seats.map((seat) => {
          const moveTargets = openSeats.filter((target) => target.playerId !== seat.playerId);
          return (
            <li key={seat.playerId} className="host-seat-row">
              <span className="host-seat-name">{seat.name}</span>
              {seat.isHost ? (
                <>
                  <span className="host-seat-badge">You (host)</span>
                  {!choosingHostSeat ? (
                    <button className="host-seat-action" type="button" onClick={() => setChoosingHostSeat(true)}>
                      Change
                    </button>
                  ) : null}
                </>
              ) : seat.guest ? (
                <>
                  <span className="host-seat-phone">
                    <span className={`host-seat-dot ${seat.guest.connected ? "is-online" : "is-away"}`} aria-hidden="true" />
                    {seat.guest.displayName}’s phone · {seat.guest.connected ? "online" : "away"}
                  </span>
                  <span className="host-seat-actions">
                    {moveTargets.length > 0 ? (
                      <select
                        className="host-seat-move"
                        aria-label={`Move ${seat.guest.displayName}’s phone`}
                        value=""
                        onChange={(event) => {
                          const playerId = event.currentTarget.value;
                          if (playerId && seat.guest) onAssignSeat(seat.guest.id, playerId);
                        }}
                      >
                        <option value="" disabled>
                          Move
                        </option>
                        {moveTargets.map((target) => (
                          <option key={target.playerId} value={target.playerId}>
                            To {target.name}
                          </option>
                        ))}
                      </select>
                    ) : null}
                    <button
                      className="host-seat-action danger"
                      type="button"
                      aria-label={`Release ${seat.name}’s seat`}
                      onClick={() => seat.guest && onReleaseSeat(seat.guest.id)}
                    >
                      Release
                    </button>
                  </span>
                </>
              ) : (
                <span className="host-seat-phone">
                  <span className="host-seat-dot" aria-hidden="true" />
                  No phone yet
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
