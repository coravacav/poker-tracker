import { Copy, Eye, EyeOff, Radio, RefreshCw, Share2, StopCircle, UserRound, WifiOff, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { QrCode } from "./QrCode";
import { SaveSharedGameButton } from "./SaveSharedGameButton";
import { useDialogFocus } from "./useDialogFocus";
import { useFormatCurrency } from "./CurrencyContext";
import { HostSeatList } from "./HostSeatList";
import { HostAgreementNeeds, hostNeedsCount } from "./HostAgreementNeeds";
import { useNow } from "./guestPlay/useNow";
import type { GameState } from "../domain/pokerTypes";
import { createWatchUrl, watchLinkIdForSecret } from "../session/capabilities";
import type { AgreementResult, HostRecovery, HostRoomProjection } from "../session/types";
import type { Id } from "../../convex/_generated/dataModel";

type HostSharingControlsProps = {
  recovery: HostRecovery;
  room: HostRoomProjection | null;
  connected: boolean;
  roomReady: boolean;
  roomUnavailable: boolean;
  pending: boolean;
  recoveryRequired: boolean;
  error: string | null;
  onClaimHost: () => void;
  onEnd: () => void;
  onRetryRecovery: () => void;
  onRetryRoom: () => void;
  onContinueLocally: () => void;
  onCreateNewShare: () => void;
  onDecideGuestTransaction: (
    requestId: Id<"roomGuestRequests">,
    decision: "approved" | "rejected"
  ) => void;
  onSetJoiningOpen: (open: boolean) => void;
  onSetFriendVisibility: (visible: boolean) => void;
  onRotateInvite: () => void;
  /** Turns the watch link on with a new secret (also how it is rotated), or off. */
  onSetWatchLink: (on: boolean) => void;
  onRevokeGuest: (guestId: Id<"roomGuests">) => void;
  onReleaseSeat: (guestId: Id<"roomGuests">, playerId: string) => void;
  onAssignSeat: (guestId: Id<"roomGuests">, playerId: string) => void;
  onSetHostPlayer: (playerId: string | null) => void;
  /** Turns "Players confirm each other" on or off. */
  onSetPeerConfirm?: (on: boolean) => void;
  onHostAnswerAgreement?: (
    agreementId: Id<"roomAgreements">,
    answer: "confirm" | "not_right"
  ) => Promise<AgreementResult | null>;
  onResolveBouncedAgreement?: (
    agreementId: Id<"roomAgreements">,
    decision: "dismiss" | "record"
  ) => Promise<AgreementResult | null>;
};

type ShareTab = "players" | "watchers";

function useCopy() {
  const [copied, setCopied] = useState(false);
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }
  return { copied, copy };
}

/** The short id of a stored watch secret, once computed (null until then). */
function useWatchLinkId(secret: string | undefined): string | null {
  const [computed, setComputed] = useState<{ secret: string; id: string } | null>(null);
  useEffect(() => {
    if (!secret) return;
    let cancelled = false;
    void watchLinkIdForSecret(secret)
      .then((id) => {
        if (!cancelled) setComputed({ secret, id });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [secret]);
  return secret && computed?.secret === secret ? computed.id : null;
}

/** The Watchers tab: the read-only watch link, its QR code, rotate and turn off, and who is watching. */
function WatchLinkPanel({
  publicId,
  spectatorSecret,
  on,
  currentLinkId,
  watcherCount,
  onSetWatchLink
}: {
  publicId: string;
  spectatorSecret?: string;
  on: boolean;
  /** The server's id for the current link; a stored secret with another id was replaced elsewhere. */
  currentLinkId?: string | null;
  watcherCount: number;
  onSetWatchLink: (on: boolean) => void;
}) {
  const { copied, copy } = useCopy();
  const storedLinkId = useWatchLinkId(spectatorSecret);
  if (!on) {
    return (
      <div className="watch-link-panel">
        <p className="muted">
          Anyone with the watch link sees the table, the chip key, and the results live. They can’t join
          or send requests, and they don’t take a guest spot.
        </p>
        <button className="primary-button" type="button" onClick={() => onSetWatchLink(true)}>
          <Eye size={16} /> Turn on watch link
        </button>
      </div>
    );
  }
  // Another tab or device may have rotated the link since this one stored it.
  const replaced = Boolean(currentLinkId && storedLinkId && storedLinkId !== currentLinkId);
  const watchUrl = spectatorSecret && !replaced ? createWatchUrl(publicId, spectatorSecret) : null;
  return (
    <div className="watch-link-panel">
      {watchUrl ? (
        <>
          <div className="share-qr" aria-label="Watch link QR code">
            <QrCode value={watchUrl} size={210} level="M" marginSize={2} />
          </div>
          <p className="muted">Watchers scan this to follow the game. They can’t change anything.</p>
          <label className="invite-link-field">
            <span>Watch link</span>
            <span>
              <input aria-label="Watch link" readOnly value={watchUrl} />
              <button className="text-button" type="button" onClick={() => void copy(watchUrl)}>
                <Copy size={15} /> {copied ? "Copied" : "Copy"}
              </button>
            </span>
          </label>
        </>
      ) : (
        <div className="notice notice-warning">
          {replaced
            ? "The watch link was changed in another tab or on another device. Make a new one to share it from here."
            : "The watch link is on, but this device doesn’t have it. Make a new one to share it from here."}
        </div>
      )}
      <div className="invite-management-row">
        <button className="text-button" type="button" onClick={() => onSetWatchLink(true)}>
          <RefreshCw size={15} /> {watchUrl ? "Rotate link" : "New watch link"}
        </button>
        <button className="text-button danger" type="button" onClick={() => onSetWatchLink(false)}>
          <EyeOff size={15} /> Turn off
        </button>
      </div>
      <div className="guest-count"><Eye size={16} /> {watcherCount} watching</div>
    </div>
  );
}

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
  roomReady,
  roomUnavailable,
  pending,
  recoveryRequired,
  error,
  onClaimHost,
  onEnd,
  onRetryRecovery,
  onRetryRoom,
  onContinueLocally,
  onCreateNewShare,
  onDecideGuestTransaction,
  onSetJoiningOpen,
  onSetFriendVisibility,
  onRotateInvite,
  onSetWatchLink,
  onRevokeGuest,
  onReleaseSeat,
  onAssignSeat,
  onSetHostPlayer,
  onSetPeerConfirm,
  onHostAnswerAgreement,
  onResolveBouncedAgreement
}: HostSharingControlsProps) {
  const formatCurrency = useFormatCurrency();
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<ShareTab>("players");
  const { copied, copy } = useCopy();
  const duplicate = room?.controllerStatus === "duplicate";
  const dialogRef = useDialogFocus<HTMLElement>(open, () => setOpen(false));

  const sharingLive = connected && roomReady && room?.status === "active";
  const statusLabel = recoveryRequired
    ? "Recovery needed"
    : roomUnavailable
      ? "Share unavailable"
      : sharingLive
        ? "Sharing live"
        : "Reconnecting";
  // Guest requests wait until the host decides, so keep them visible while the dialog is closed.
  const waitingRequests = room?.status === "active" ? (room.guestRequests?.length ?? 0) : 0;
  // So are entries players agreed on that need the host (answers for phoneless seats, disputes).
  const needsNow = useNow((room?.needsHost?.answer.length ?? 0) > 0);
  const needsYou = room?.status === "active" ? hostNeedsCount(room.needsHost, needsNow) : 0;
  const waitingLabel = [
    waitingRequests > 0 ? `${waitingRequests} guest ${waitingRequests === 1 ? "request" : "requests"} waiting` : null,
    needsYou > 0 ? `${needsYou} ${needsYou === 1 ? "entry needs" : "entries need"} you` : null
  ].filter(Boolean).join(", ");

  return (
    <div className="sharing-controls">
      <button
        className="share-button is-active"
        type="button"
        aria-label={waitingLabel ? `${statusLabel}, ${waitingLabel}` : undefined}
        onClick={() => {
          // Guest requests live on Players, so the dialog opens there.
          setTab("players");
          setOpen(true);
        }}
      >
        {sharingLive ? <Radio size={16} /> : <WifiOff size={16} />}
        {statusLabel}
        {waitingRequests + needsYou > 0 ? (
          <strong className="notification-count">{waitingRequests + needsYou}</strong>
        ) : null}
      </button>
      {open
        ? createPortal(
            // The header's backdrop-filter would otherwise make this fixed overlay
            // resolve its inset against the header instead of the viewport.
            <div className="drawer-backdrop sharing-backdrop" role="presentation">
              <section
                ref={dialogRef}
                tabIndex={-1}
                className="share-dialog"
                role="dialog"
                aria-modal="true"
                aria-label="Share game"
              >
                <div className="drawer-heading">
                  <div>
                    <p className="eyebrow">Realtime sharing</p>
                    <h2>{room?.name ?? recovery.roomName}</h2>
                  </div>
                  <button className="icon-button" type="button" onClick={() => setOpen(false)} title="Close">
                    <X size={17} />
                  </button>
                </div>

                <div className="share-dialog-body">
                  {roomUnavailable ? (
                    <>
                      <div className="notice notice-warning">
                        <div className="share-recovery-copy">
                          <strong>Shared room unavailable.</strong>
                          <p>
                            {error ?? "The room could not be found on the current deployment."}
                          </p>
                          <p>Your latest accepted game is safe on this device. The old invite will not work.</p>
                        </div>
                      </div>
                      <div className="share-dialog-actions">
                        <button className="primary-button" type="button" onClick={onRetryRoom}>
                          <RefreshCw size={16} /> Retry room
                        </button>
                        <button className="primary-button" type="button" onClick={onCreateNewShare}>
                          <Share2 size={16} /> Create new share
                        </button>
                        <button className="text-button" type="button" onClick={onContinueLocally}>
                          Continue locally
                        </button>
                      </div>
                    </>
                  ) : !roomReady || !room ? (
                    <>
                      <div className="notice notice-warning">
                        {connected ? "Restoring the shared room…" : "Waiting for the shared room connection…"}
                      </div>
                      {error ? <div className="notice notice-warning">{error}</div> : null}
                    </>
                  ) : (
                    <>
                      <div className="shape-segments share-link-segments" aria-label="Link type">
                        {(["players", "watchers"] as const).map((option) => (
                          <button
                            key={option}
                            type="button"
                            aria-pressed={tab === option}
                            onClick={() => setTab(option)}
                          >
                            {option === "players" ? "Players" : "Watchers"}
                          </button>
                        ))}
                      </div>
                      {tab === "watchers" ? (
                        <WatchLinkPanel
                          publicId={recovery.publicId}
                          spectatorSecret={recovery.spectatorSecret}
                          on={room.watchLinkOn === true}
                          currentLinkId={room.watchLinkId}
                          watcherCount={room.watcherCount ?? 0}
                          onSetWatchLink={onSetWatchLink}
                        />
                      ) : (
                        <>
                        <div className="share-qr" aria-label="Guest invitation QR code">
                          <QrCode value={recovery.inviteUrl} size={210} level="M" marginSize={2} />
                        </div>
                        <p className="muted">Players scan this with their camera to pick their seat.</p>
                        <label className="invite-link-field">
                          <span>Invite link</span>
                          <span>
                            <input aria-label="Invite link" readOnly value={recovery.inviteUrl} />
                            <button className="text-button" type="button" onClick={() => void copy(recovery.inviteUrl)}>
                              <Copy size={15} /> {copied ? "Copied" : "Copy"}
                            </button>
                          </span>
                        </label>
                        <div className="invite-management-row">
                          <label>
                            <input
                              type="checkbox"
                              checked={room.joiningOpen !== false}
                              onChange={(event) => onSetJoiningOpen(event.currentTarget.checked)}
                            />
                            Accept new guests
                          </label>
                          <button className="text-button" type="button" onClick={onRotateInvite}>
                            <RefreshCw size={15} /> Rotate invite
                          </button>
                        </div>
                        {room.peerConfirm !== undefined && onSetPeerConfirm ? (
                          <label className="peer-confirm-toggle">
                            <input
                              type="checkbox"
                              checked={room.peerConfirm}
                              aria-describedby="peer-confirm-help"
                              onChange={(event) => onSetPeerConfirm(event.currentTarget.checked)}
                            />
                            <span>
                              <strong>Players confirm each other</strong>
                              <small id="peer-confirm-help">
                                {room.peerConfirm
                                  ? "Give, buy, and bank buy-ins are recorded when another player agrees. You don’t need to approve."
                                  : "Players send their chips to you as requests to approve."}
                              </small>
                            </span>
                          </label>
                        ) : null}
                        {room.needsHost && onHostAnswerAgreement && onResolveBouncedAgreement ? (
                          <HostAgreementNeeds
                            needs={room.needsHost}
                            hostPlayerId={room.hostPlayerId ?? null}
                            onAnswer={onHostAnswerAgreement}
                            onResolve={onResolveBouncedAgreement}
                          />
                        ) : null}
                        {room.friendProfileLinked ? (
                          <label className="friend-visibility-toggle">
                            <input
                              type="checkbox"
                              checked={room.visibleToFriends}
                              onChange={(event) => onSetFriendVisibility(event.currentTarget.checked)}
                            />
                            Show this room to followers on Home
                          </label>
                        ) : null}
                        <div className="guest-count"><UserRound size={16} /> {room.guestCount} currently online</div>
                        {room.seats ? (
                          <HostSeatList
                            seats={room.seats}
                            hostPlayerId={room.hostPlayerId ?? null}
                            hostNotPlaying={room.hostNotPlaying === true}
                            onReleaseSeat={onReleaseSeat}
                            onAssignSeat={onAssignSeat}
                            onSetHostPlayer={onSetHostPlayer}
                          />
                        ) : null}
                        {(room.guests?.length ?? 0) > 0 ? (
                          <section className="guest-management-list" aria-labelledby="host-phones-title">
                            <div className="host-seat-heading">
                              <h3 id="host-phones-title">Phones</h3>
                              <span className="muted">Revoke removes a phone from the game</span>
                            </div>
                            {room.guests?.map((guest) => (
                              <div className="guest-management-item" key={guest.id}>
                                <span className={guest.connected ? "positive" : "muted"}>
                                  {guest.displayName} · {guest.revoked ? "Revoked" : guest.connected ? "Online" : "Away"}
                                </span>
                                {!guest.revoked ? (
                                  <button className="text-button danger" type="button" onClick={() => onRevokeGuest(guest.id)}>
                                    Revoke
                                  </button>
                                ) : null}
                              </div>
                            ))}
                          </section>
                        ) : null}
                        {(room.guestRequests?.length ?? 0) > 0 ? (
                          <div className="guest-request-list">
                            <h3>Guest requests</h3>
                            {room.guestRequests?.map((request) => (
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
                        </>
                      )}
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
                            disabled={!connected || !roomReady || pending || duplicate}
                            onClick={onEnd}
                          >
                            <StopCircle size={16} /> {pending ? "Finishing…" : "Stop sharing"}
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </section>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

export function GuestSessionControls({
  connected,
  ended,
  displayName,
  seatName,
  hostProfile,
  followingHost,
  onFollowHost,
  onLeave,
  savableGame
}: {
  connected: boolean;
  ended: boolean;
  displayName: string;
  /** The guest's seat's player name, while they hold a seat. */
  seatName?: string;
  hostProfile?: { friendCode: string; displayName: string } | null;
  followingHost?: boolean;
  onFollowHost?: () => void;
  onLeave: () => void;
  /** The room's game and when it closed, offered for saving once the room has ended (null when a later room of it was joined). */
  savableGame?: { state: GameState; closedAt: number } | null;
}) {
  return (
    <div className="guest-session-controls">
      <span className="guest-session-status">{ended
          ? "Session ended"
          : !connected
            ? "Reconnecting"
            : seatName
              ? `Playing as ${seatName}`
              : `Viewing as ${displayName}`}</span>
      {hostProfile ? (
        <button className="text-button" type="button" disabled={followingHost} onClick={onFollowHost}>
          <UserRound size={15} /> {followingHost ? `Following ${hostProfile.displayName}` : `Follow ${hostProfile.displayName}`}
        </button>
      ) : null}
      {ended && savableGame ? <SaveSharedGameButton compact {...savableGame} /> : null}
      <button className="text-button guest-leave-button" type="button" onClick={onLeave}>Leave</button>
    </div>
  );
}
