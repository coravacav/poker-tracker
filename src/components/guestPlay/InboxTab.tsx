import { Check, Landmark } from "lucide-react";
import { useState } from "react";
import type { Id } from "../../../convex/_generated/dataModel";
import type { AgreementResult, AgreementStatus, GuestAgreements, RoomAgreement } from "../../session/types";
import { useFormatCurrency } from "../CurrencyContext";
import {
  agreementSentence,
  agreementSettleLine,
  agreementTime,
  bouncedByLine,
  closedNotice,
  confirmedLine,
  isExpired,
  waitingOnLine
} from "./agreementText";
import { useNow } from "./useNow";

type InboxTabProps = {
  seatPlayerId: string;
  agreements: GuestAgreements;
  /** A note from elsewhere (an entry just sent, or why a request failed). */
  notice: string | null;
  /** Why the last request failed, if it did. */
  error?: string | null;
  onAnswer: (agreementId: Id<"roomAgreements">, answer: "confirm" | "not_right") => Promise<AgreementResult | null>;
  onCancel: (agreementId: Id<"roomAgreements">) => Promise<AgreementResult | null>;
  onDismiss: (agreementId: Id<"roomAgreements">) => Promise<AgreementResult | null>;
  onResend: (agreement: RoomAgreement) => void;
};

/** Open entries waiting on this guest that haven't expired. */
export function waitingOnMeCount(agreements: GuestAgreements | undefined, nowMs: number): number {
  return agreements?.needsMe.filter((agreement) => !isExpired(agreement, nowMs)).length ?? 0;
}

/** Inbox: Needs you · Waiting on others · Bounced back · Done. */
export function InboxTab({
  seatPlayerId,
  agreements,
  notice,
  error = null,
  onAnswer,
  onCancel,
  onDismiss,
  onResend
}: InboxTabProps) {
  const formatCurrency = useFormatCurrency();
  const format = (cents: number) => formatCurrency(cents, { trimWholeCents: true });
  const now = useNow(agreements.needsMe.length > 0 || agreements.mine.length > 0);
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  const [resultNotice, setResultNotice] = useState<string | null>(null);
  const { needsMe, mine, bounced, recentDone } = agreements;
  const waitingCount = waitingOnMeCount(agreements, now);

  async function run(
    agreementId: Id<"roomAgreements">,
    expected: AgreementStatus,
    request: () => Promise<AgreementResult | null>
  ) {
    if (busy.has(agreementId)) return;
    setBusy((current) => new Set(current).add(agreementId));
    setResultNotice(null);
    const result = await request();
    setBusy((current) => {
      const next = new Set(current);
      next.delete(agreementId);
      return next;
    });
    if (result) setResultNotice(closedNotice(result, expected));
  }

  return (
    <div className="guest-tab guest-inbox-tab">
      <div className="guest-tab-column">
        {notice ? <div className="notice notice-ok" role="status">{notice}</div> : null}
        {error ? <div className="notice notice-warning">{error}</div> : null}
        {resultNotice ? <div className="notice notice-warning" role="status">{resultNotice}</div> : null}

        <section className="guest-inbox-section" aria-labelledby="inbox-needs-you">
          <div className="guest-inbox-heading">
            <h2 id="inbox-needs-you">Needs you</h2>
            {waitingCount > 0 ? <strong className="notification-count">{waitingCount}</strong> : null}
          </div>
          {needsMe.length === 0 ? (
            <p className="muted guest-inbox-empty">Nothing waiting on you.</p>
          ) : (
            needsMe.map((agreement) => {
              const expired = isExpired(agreement, now);
              const bank = agreement.kind === "bank";
              const settleLine = agreementSettleLine(agreement, seatPlayerId, format);
              const askedMe = bank && agreement.witnessPlayerId === seatPlayerId;
              return (
                <article
                  key={agreement.id}
                  className={`guest-inbox-card ${expired ? "is-expired" : ""}`}
                  aria-label={agreementSentence(agreement, seatPlayerId, format)}
                >
                  <div className="guest-inbox-card-main">
                    <span className={`guest-inbox-avatar ${bank ? "is-bank" : ""}`} aria-hidden="true">
                      {bank ? <Landmark size={16} /> : agreement.proposerName.charAt(0).toUpperCase()}
                    </span>
                    <div>
                      <span className="guest-inbox-eyebrow">
                        {bank
                          ? askedMe ? `${agreement.proposerName} asked you · From bank` : "Witness needed · From bank"
                          : `From ${agreement.proposerName} · ${agreement.kind === "give" ? "Give" : "Buy"}`}
                      </span>
                      <h3>{agreementSentence(agreement, seatPlayerId, format)}</h3>
                      {agreement.note ? <p className="guest-inbox-note">“{agreement.note}”</p> : null}
                      <p className="muted">
                        {expired
                          ? "Expired · nobody answered in time"
                          : `${settleLine ?? (askedMe ? "Did you see the money go in?" : "Did you see the money go in? Any player can confirm.")} · ${agreementTime(agreement.createdAt)}`}
                      </p>
                    </div>
                  </div>
                  {expired ? (
                    <span className="guest-inbox-expired">Expired</span>
                  ) : (
                    <div className="guest-inbox-actions">
                      <button
                        className={`text-button ${bank ? "" : "guest-not-right"}`}
                        type="button"
                        disabled={busy.has(agreement.id)}
                        onClick={() => void run(agreement.id, "bounced", () => onAnswer(agreement.id, "not_right"))}
                      >
                        {bank ? "I didn't see it" : "Not right"}
                      </button>
                      <button
                        className="primary-button"
                        type="button"
                        disabled={busy.has(agreement.id)}
                        onClick={() => void run(agreement.id, "recorded", () => onAnswer(agreement.id, "confirm"))}
                      >
                        {bank ? "I saw it" : "Confirm"}
                      </button>
                    </div>
                  )}
                </article>
              );
            })
          )}
        </section>

        {mine.length > 0 ? (
          <section className="guest-inbox-section" aria-labelledby="inbox-waiting">
            <h2 id="inbox-waiting" className="guest-inbox-subheading">Waiting on others</h2>
            {mine.map((agreement) => {
              const expired = isExpired(agreement, now);
              return (
                <div key={agreement.id} className={`guest-inbox-row ${expired ? "is-expired" : ""}`}>
                  <div>
                    <strong>{agreementSentence(agreement, seatPlayerId, format)}</strong>
                    <span className="muted">
                      {expired ? "Expired · nobody answered in time" : `${waitingOnLine(agreement)} · ${agreementTime(agreement.createdAt)}`}
                    </span>
                  </div>
                  {expired ? (
                    <span className="guest-inbox-expired">Expired</span>
                  ) : (
                    <button
                      className="text-button"
                      type="button"
                      disabled={busy.has(agreement.id)}
                      onClick={() => void run(agreement.id, "cancelled", () => onCancel(agreement.id))}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              );
            })}
          </section>
        ) : null}

        {bounced.length > 0 ? (
          <section className="guest-inbox-section" aria-labelledby="inbox-bounced">
            <h2 id="inbox-bounced" className="guest-inbox-subheading">Bounced back</h2>
            {bounced.map((agreement) => (
              <div key={agreement.id} className="guest-inbox-row is-bounced">
                <div>
                  <strong>{bouncedByLine(agreement, seatPlayerId)}</strong>
                  <span className="muted">{agreementSentence(agreement, seatPlayerId, format)}</span>
                  {agreement.bounceReason ? <span className="muted">“{agreement.bounceReason}”</span> : null}
                </div>
                <div className="guest-inbox-row-actions">
                  <button
                    className="text-button"
                    type="button"
                    disabled={busy.has(agreement.id)}
                    onClick={() => void run(agreement.id, "dismissed", () => onDismiss(agreement.id))}
                  >
                    Dismiss
                  </button>
                  <button className="text-button" type="button" onClick={() => onResend(agreement)}>
                    Edit &amp; resend
                  </button>
                </div>
              </div>
            ))}
          </section>
        ) : null}

        {recentDone.length > 0 ? (
          <section className="guest-inbox-section" aria-labelledby="inbox-done">
            <h2 id="inbox-done" className="guest-inbox-subheading">Done</h2>
            <ul className="guest-done-list">
              {recentDone.map((agreement) => (
                <li key={agreement.id} className={agreement.voided ? "is-voided" : undefined}>
                  <span className="spectator-feed-mark" aria-hidden="true">
                    <Check size={12} strokeWidth={3} />
                  </span>
                  <span className="spectator-feed-text">
                    <span>{agreementSentence(agreement, seatPlayerId, format)}</span>
                    <span className="muted">
                      {confirmedLine(agreement, seatPlayerId)} · {agreementTime(agreement.decidedAt ?? agreement.createdAt)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}
