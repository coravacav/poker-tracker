import { useState } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import type { AgreementResult, AgreementStatus, HostAgreementNeeds as Needs } from "../session/types";
import { useFormatCurrency } from "./CurrencyContext";
import {
  agreementSentence,
  agreementTime,
  bouncedByLine,
  closedNotice,
  isExpired,
  type AgreementRequest
} from "./guestPlay/agreementText";
import { useNow } from "./guestPlay/useNow";

/** Entries in the host's Needs you right now: open ones that haven't expired, and bounced ones. */
export function hostNeedsCount(needs: Needs | undefined, nowMs: number): number {
  if (!needs) return 0;
  return needs.answer.filter((agreement) => !isExpired(agreement, nowMs)).length + needs.bounced.length;
}

const answerLabels = { self: "as you", bank: "bank buy-in" } as const;

/**
 * The share dialog's Needs you: entries the host answers (for the host's own
 * seat, a seat no phone holds, or a bank buy-in), and entries a player said
 * weren't right, to Dismiss or Record anyway.
 */
export function HostAgreementNeeds({
  needs,
  hostPlayerId,
  onAnswer,
  onResolve
}: {
  needs: Needs;
  hostPlayerId: string | null;
  onAnswer: (agreementId: Id<"roomAgreements">, answer: "confirm" | "not_right") => Promise<AgreementResult | null>;
  onResolve: (agreementId: Id<"roomAgreements">, decision: "dismiss" | "record") => Promise<AgreementResult | null>;
}) {
  const formatCurrency = useFormatCurrency();
  const format = (cents: number) => formatCurrency(cents, { trimWholeCents: true });
  const now = useNow(needs.answer.length > 0);
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const answer = needs.answer.filter((agreement) => !isExpired(agreement, now));
  const count = answer.length + needs.bounced.length;
  if (count === 0 && notice === null) return null;

  async function run(
    agreementId: Id<"roomAgreements">,
    expected: AgreementStatus,
    kind: AgreementRequest,
    request: () => Promise<AgreementResult | null>
  ) {
    if (busy.has(agreementId)) return;
    setBusy((current) => new Set(current).add(agreementId));
    setNotice(null);
    const result = await request();
    setBusy((current) => {
      const next = new Set(current);
      next.delete(agreementId);
      return next;
    });
    if (result) setNotice(closedNotice(result, expected, kind));
  }

  return (
    <section className="host-needs" aria-labelledby="host-needs-title">
      <div className="host-seat-heading">
        <h3 id="host-needs-title">Needs you</h3>
        {count > 0 ? <strong className="notification-count">{count}</strong> : null}
      </div>
      {notice ? <div className="notice notice-warning" role="status">{notice}</div> : null}
      {answer.map((agreement) => {
        const bank = agreement.kind === "bank";
        const label = agreement.answerAs === "seat"
          ? `for ${agreement.counterpartyName ?? "a player"} (no phone when sent)`
          : answerLabels[agreement.answerAs];
        const viewer = agreement.answerAs === "self" ? hostPlayerId : null;
        return (
          <article key={agreement.id} className="host-needs-item" aria-label={agreementSentence(agreement, viewer, format)}>
            <p>
              <span className="host-needs-tag">{label}</span>
              <strong>{agreementSentence(agreement, viewer, format)}</strong>
              <span className="muted"> · {agreementTime(agreement.createdAt)}</span>
            </p>
            <div className="host-needs-actions">
              <button
                className="text-button"
                type="button"
                disabled={busy.has(agreement.id)}
                onClick={() => void run(agreement.id, "bounced", "answer", () => onAnswer(agreement.id, "not_right"))}
              >
                {bank ? "I didn't see it" : "Not right"}
              </button>
              <button
                className="primary-button"
                type="button"
                disabled={busy.has(agreement.id)}
                onClick={() => void run(agreement.id, "recorded", "answer", () => onAnswer(agreement.id, "confirm"))}
              >
                {bank ? "I saw it" : "Confirm"}
              </button>
            </div>
          </article>
        );
      })}
      {needs.bounced.map((agreement) => (
        <article key={agreement.id} className="host-needs-item is-bounced" aria-label={bouncedByLine(agreement, null)}>
          <p>
            <strong>{bouncedByLine(agreement, null)}:</strong> {agreementSentence(agreement, null, format)}
            <span className="muted"> · {agreementTime(agreement.decidedAt ?? agreement.createdAt)}</span>
            {agreement.bounceReason ? <span className="muted host-needs-reason">“{agreement.bounceReason}”</span> : null}
          </p>
          <div className="host-needs-actions">
            <button
              className="text-button"
              type="button"
              disabled={busy.has(agreement.id)}
              onClick={() => void run(agreement.id, "bounced", "resolve", () => onResolve(agreement.id, "dismiss"))}
            >
              Dismiss
            </button>
            <button
              className="primary-button"
              type="button"
              disabled={busy.has(agreement.id)}
              onClick={() => void run(agreement.id, "recorded", "resolve", () => onResolve(agreement.id, "record"))}
            >
              Record anyway
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}
