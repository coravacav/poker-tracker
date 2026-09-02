import { Copy, Radio, RefreshCw, Share2, StopCircle, UserRound, WifiOff, X } from "lucide-react";
import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { formatCurrency } from "../domain/money";
import type { HostRecovery, HostRoomProjection } from "../session/types";
import type { Id } from "../../convex/_generated/dataModel";

type HostSharingControlsProps = {
  recovery: HostRecovery;
  room: HostRoomProjection | null;
  connected: boolean;
  pending: boolean;
  recoveryRequired: boolean;
  error: string | null;
  onClaimHost: () => void;
  onEnd: () => void;
  onRetryRecovery: () => void;
  onDecideGuestTransaction: (
    requestId: Id<"roomGuestRequests">,
    decision: "approved" | "rejected"
  ) => void;
};

export function LocalShareButton({ onShare }: { onShare: () => void }) {
  return (
    <button className="share-button" type="button" onClick={onShare}>
      <Share2 size={16} />
      Share game
    </button>
  );
}

export function HostSharingControls({
  recovery,
  room,
  connected,
  pending,
  recoveryRequired,
  error,
  onClaimHost,
  onEnd,
  onRetryRecovery,
  onDecideGuestTransaction
}: HostSharingControlsProps) {
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const duplicate = room?.controllerStatus === "duplicate";

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(recovery.inviteUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="sharing-controls">
      <button className="share-button is-active" type="button" onClick={() => setOpen(true)}>
        {connected ? <Radio size={16} /> : <WifiOff size={16} />}
        {recoveryRequired ? "Recovery needed" : connected ? "Sharing live" : "Reconnecting"}
      </button>
      {open ? (
        <div className="drawer-backdrop sharing-backdrop" role="presentation">
          <section className="share-dialog" role="dialog" aria-modal="true" aria-label="Share game">
            <div className="drawer-heading">
              <div>
                <p className="eyebrow">Realtime guest view</p>
                <h2>{room?.name ?? recovery.roomName}</h2>
              </div>
              <button className="icon-button" type="button" onClick={() => setOpen(false)} title="Close">
                <X size={17} />
              </button>
            </div>

            <div className="share-dialog-body">
              <div className="share-qr" aria-label="Guest invitation QR code">
                <QRCodeSVG value={recovery.inviteUrl} size={210} level="M" marginSize={2} />
              </div>
              <p className="muted">Guests scan this code with their normal camera for a read-only live view.</p>
              <label className="invite-link-field">
                <span>Invite link</span>
                <span>
                  <input aria-label="Invite link" readOnly value={recovery.inviteUrl} />
                  <button className="text-button" type="button" onClick={() => void copyInvite()}>
                    <Copy size={15} /> {copied ? "Copied" : "Copy"}
                  </button>
                </span>
              </label>
              <div className="guest-count"><UserRound size={16} /> {room?.guestCount ?? 0} connected guests</div>
              {(room?.guestRequests?.length ?? 0) > 0 ? (
                <div className="guest-request-list">
                  <h3>Guest requests</h3>
                  {room?.guestRequests?.map((request) => (
                    <article key={request.id} className="guest-request-item">
                      <div>
                        <strong>{request.displayName ?? "Guest"}</strong>
                        <span>
                          {request.transaction.type.replace(/_/g, " ")} · {formatCurrency(request.transaction.amountCents)}
                        </span>
                      </div>
                      <div>
                        <button className="text-button" type="button" onClick={() => onDecideGuestTransaction(request.id, "rejected")}>Reject</button>
                        <button className="primary-button" type="button" onClick={() => onDecideGuestTransaction(request.id, "approved")}>Approve</button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : null}
              {!connected ? <div className="notice notice-warning">Host edits are paused until the room reconnects.</div> : null}
              {duplicate ? (
                <div className="notice notice-warning">
                  Another tab currently controls this room.
                  <button className="text-button" type="button" onClick={onClaimHost}>Take control here</button>
                </div>
              ) : null}
              {error ? <div className="notice notice-warning">{error}</div> : null}
              <div className="share-dialog-actions">
                {recoveryRequired ? (
                  <button className="primary-button" type="button" onClick={onRetryRecovery}>
                    <RefreshCw size={16} /> Retry final sync
                  </button>
                ) : (
                  <button
                    className="danger-button"
                    type="button"
                    disabled={!connected || pending || duplicate}
                    onClick={onEnd}
                  >
                    <StopCircle size={16} /> {pending ? "Finishing…" : "Stop sharing"}
                  </button>
                )}
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

export function GuestSessionControls({
  connected,
  ended,
  displayName,
  onLeave
}: {
  connected: boolean;
  ended: boolean;
  displayName: string;
  onLeave: () => void;
}) {
  return (
    <div className="guest-session-controls">
      <span>{ended ? "Session ended" : connected ? `Viewing as ${displayName}` : "Reconnecting"}</span>
      <button className="text-button" type="button" onClick={onLeave}>Leave</button>
    </div>
  );
}
