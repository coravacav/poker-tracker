import { Copy, Smartphone } from "lucide-react";
import { useState } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import type { HostSeat } from "../session/types";
import { useNow } from "./guestPlay/useNow";
import { QrCode } from "./QrCode";

type PhoneLink = { url: string; expiresAt: number };

/** Marker for "I'm not playing" in the host-seat picker. */
const NOT_PLAYING = "__not_playing__";

/**
 * The share dialog's Seats list: which phone holds each active seat (with
 * Release and Move), and which seat is the host's own. The host can also put
 * their own phone in their seat with a one-time link.
 */
export function HostSeatList({
  seats,
  hostPlayerId,
  hostNotPlaying = false,
  onReleaseSeat,
  onAssignSeat,
  onSetHostPlayer,
  onCreatePhoneLink,
  onCancelPhoneLink
}: {
  seats: HostSeat[];
  hostPlayerId: string | null;
  /** The host said they aren't playing (kept by the room), so don't ask again. */
  hostNotPlaying?: boolean;
  /** `playerId` is the seat shown, so a phone that has since moved isn't released. */
  onReleaseSeat: (guestId: Id<"roomGuests">, playerId: string) => void;
  onAssignSeat: (guestId: Id<"roomGuests">, playerId: string) => void;
  onSetHostPlayer: (playerId: string | null) => void;
  /** Makes a one-time link for the host's own phone; null when it failed. */
  onCreatePhoneLink?: () => Promise<PhoneLink | null>;
  /** Voids an unused phone link (Done). */
  onCancelPhoneLink?: () => void;
}) {
  const [choosingHostSeat, setChoosingHostSeat] = useState(false);
  const [phoneLink, setPhoneLink] = useState<PhoneLink | null>(null);
  const [makingLink, setMakingLink] = useState(false);
  const [copied, setCopied] = useState(false);
  const now = useNow(phoneLink !== null);
  if (seats.length === 0) return null;
  const hostSeat = seats.find((seat) => seat.isHost) ?? null;
  // Shown until the phone is in the seat, the link runs out, or the host closes it.
  const showPhoneLink = phoneLink !== null && hostSeat !== null && !hostSeat.guest && now < phoneLink.expiresAt;

  async function makePhoneLink() {
    if (!onCreatePhoneLink || makingLink) return;
    setMakingLink(true);
    const link = await onCreatePhoneLink();
    setMakingLink(false);
    setCopied(false);
    if (link) setPhoneLink(link);
  }

  async function copyPhoneLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  const phones = seats.filter((seat) => seat.guest !== null).length;
  const openSeats = seats.filter((seat) => !seat.guest && !seat.isHost);
  const showHostPrompt = choosingHostSeat || (hostPlayerId === null && !hostNotPlaying);

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
                onSetHostPlayer(null);
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
                  {seat.guest ? (
                    <span className="host-seat-phone">
                      <span className={`host-seat-dot ${seat.guest.connected ? "is-online" : "is-away"}`} aria-hidden="true" />
                      Your phone · {seat.guest.connected ? "online" : "away"}
                    </span>
                  ) : null}
                  <span className="host-seat-actions">
                    {seat.guest ? (
                      <button
                        className="host-seat-action danger"
                        type="button"
                        aria-label="Disconnect your phone"
                        onClick={() => seat.guest && onReleaseSeat(seat.guest.id, seat.playerId)}
                      >
                        Disconnect
                      </button>
                    ) : onCreatePhoneLink && !showPhoneLink ? (
                      <button
                        className="host-seat-action"
                        type="button"
                        disabled={makingLink}
                        onClick={() => void makePhoneLink()}
                      >
                        <Smartphone size={15} aria-hidden="true" /> {makingLink ? "Making link…" : "Use on my phone"}
                      </button>
                    ) : null}
                    {!choosingHostSeat ? (
                      <button className="host-seat-action" type="button" onClick={() => setChoosingHostSeat(true)}>
                        Change
                      </button>
                    ) : null}
                  </span>
                  {showPhoneLink ? (
                    <div className="host-phone-link" role="group" aria-label="Your phone link">
                      <div className="share-qr" aria-label="Your phone link QR code">
                        <QrCode value={phoneLink.url} size={180} level="M" marginSize={2} />
                      </div>
                      <p className="muted">
                        Scan with your phone’s camera to play as {seat.name} there too: buy in, send chips, and
                        confirm entries. Works once, for 10 minutes, until you tap Done. Don’t share it: it opens your seat.
                      </p>
                      <label className="invite-link-field">
                        <span>Your phone link</span>
                        <span>
                          <input aria-label="Your phone link" readOnly value={phoneLink.url} />
                          <button className="text-button" type="button" onClick={() => void copyPhoneLink(phoneLink.url)}>
                            <Copy size={15} aria-hidden="true" /> {copied ? "Copied" : "Copy"}
                          </button>
                        </span>
                      </label>
                      <button
                        className="text-button"
                        type="button"
                        onClick={() => {
                          setPhoneLink(null);
                          onCancelPhoneLink?.();
                        }}
                      >
                        Done
                      </button>
                    </div>
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
                      onClick={() => seat.guest && onReleaseSeat(seat.guest.id, seat.playerId)}
                    >
                      Release
                    </button>
                  </span>
                </>
              ) : seat.releasedByHost ? (
                <span className="host-seat-phone">
                  <span className="host-seat-dot" aria-hidden="true" />
                  Released · only you can assign it
                </span>
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
