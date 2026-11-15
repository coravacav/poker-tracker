import { Eye, WifiOff } from "lucide-react";
import { useState } from "react";
import type { SeatOption } from "../session/types";
import { openSeats, SeatPicker } from "./SeatPicker";

type GuestJoinScreenProps = {
  status: "loading" | "active" | "invalid" | "ended" | "closed" | "reconnecting";
  roomName?: string;
  /** The room's seats; with an open one the guest picks a seat instead of typing a name. */
  seats?: SeatOption[];
  error: string | null;
  joining: boolean;
  onJoin: (choice: { playerId: string } | { displayName: string }) => void;
  onCancel: () => void;
  /** Whether turning back returns to this device's own game; without one it goes Home. */
  hasLocalGame?: boolean;
  /** Headings for other links that open here (the host's phone link). */
  loadingTitle?: string;
  invalidTitle?: string;
};

export function GuestJoinScreen({
  status,
  roomName,
  seats,
  error,
  joining,
  onJoin,
  onCancel,
  hasLocalGame = true,
  loadingTitle = "Checking invitation…",
  invalidTitle = "Invitation unavailable"
}: GuestJoinScreenProps) {
  const [displayName, setDisplayName] = useState("");
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const available = openSeats(seats);
  const pickSeat = available.length > 0;
  // A seat someone else took since it was picked no longer counts as picked.
  const selectedSeat = available.find((seat) => seat.playerId === selectedPlayerId) ?? null;

  return (
    <main className="guest-join-page">
      <section className="panel guest-join-card">
        <p className="eyebrow">Poker Tracker invitation</p>
        {status === "loading" ? <h1>{loadingTitle}</h1> : null}
        {status === "reconnecting" ? (
          <>
            <WifiOff size={30} />
            <h1>Reconnecting…</h1>
            <p>{error ?? "Waiting for the shared room connection."}</p>
          </>
        ) : null}
        {status === "active" && pickSeat ? (
          <form
            className="seat-join-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (selectedSeat) onJoin({ playerId: selectedSeat.playerId });
            }}
          >
            <h1>{roomName ?? "Shared poker game"}</h1>
            <h2 className="seat-join-title">Who are you?</h2>
            <p className="muted">Pick your seat.</p>
            <SeatPicker
              seats={seats ?? []}
              selectedPlayerId={selectedSeat?.playerId ?? null}
              onSelect={setSelectedPlayerId}
            />
            <button className="primary-button" disabled={joining || !selectedSeat} type="submit">
              {joining ? "Joining…" : selectedSeat ? `Join as ${selectedSeat.name}` : "Pick your seat"}
            </button>
            <p className="muted seat-join-hint">The host can move you to a different seat.</p>
          </form>
        ) : null}
        {status === "active" && !pickSeat ? (
          <>
            <Eye size={30} />
            <h1>{roomName ?? "Shared poker game"}</h1>
            <p>
              {(seats?.length ?? 0) > 0
                ? "Every seat already has a phone. Join with your name to follow along."
                : "You’ll join with a live, read-only view. Only the host can change the ledger."}
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (displayName.trim()) onJoin({ displayName: displayName.trim() });
              }}
            >
              <label>
                <span>Display name</span>
                <input
                  autoFocus
                  maxLength={40}
                  value={displayName}
                  onChange={(event) => setDisplayName(event.currentTarget.value)}
                />
              </label>
              <button className="primary-button" disabled={joining || !displayName.trim()} type="submit">
                {joining ? "Joining…" : "Join game"}
              </button>
            </form>
          </>
        ) : null}
        {status === "invalid" || status === "ended" || status === "closed" ? (
          <>
            <WifiOff size={30} />
            <h1>{status === "ended" ? "This game has ended" : status === "closed" ? "Joining is closed" : invalidTitle}</h1>
            <p>{error ?? "Ask the host for a current invitation link."}</p>
          </>
        ) : null}
        {error && status === "active" ? <div className="notice notice-warning">{error}</div> : null}
        <button className="text-button" type="button" onClick={onCancel}>
          {hasLocalGame ? "Return to local game" : "Back to Home"}
        </button>
      </section>
    </main>
  );
}
