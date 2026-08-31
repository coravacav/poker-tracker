import { Eye, WifiOff } from "lucide-react";
import { useState } from "react";

type GuestJoinScreenProps = {
  status: "loading" | "active" | "invalid" | "ended" | "reconnecting";
  roomName?: string;
  error: string | null;
  joining: boolean;
  onJoin: (displayName: string) => void;
  onCancel: () => void;
};

export function GuestJoinScreen({
  status,
  roomName,
  error,
  joining,
  onJoin,
  onCancel
}: GuestJoinScreenProps) {
  const [displayName, setDisplayName] = useState("");

  return (
    <main className="guest-join-page">
      <section className="panel guest-join-card">
        <p className="eyebrow">Poker Tracker invitation</p>
        {status === "loading" ? <h1>Checking invitation…</h1> : null}
        {status === "reconnecting" ? (
          <>
            <WifiOff size={30} />
            <h1>Reconnecting…</h1>
            <p>{error ?? "Waiting for the shared room connection."}</p>
          </>
        ) : null}
        {status === "active" ? (
          <>
            <Eye size={30} />
            <h1>{roomName ?? "Shared poker game"}</h1>
            <p>You’ll join with a live, read-only view. Only the host can change the ledger.</p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (displayName.trim()) onJoin(displayName.trim());
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
        {status === "invalid" || status === "ended" ? (
          <>
            <WifiOff size={30} />
            <h1>{status === "ended" ? "This game has ended" : "Invitation unavailable"}</h1>
            <p>{error ?? "Ask the host for a current invitation link."}</p>
          </>
        ) : null}
        {error && status === "active" ? <div className="notice notice-warning">{error}</div> : null}
        <button className="text-button" type="button" onClick={onCancel}>Return to local game</button>
      </section>
    </main>
  );
}
