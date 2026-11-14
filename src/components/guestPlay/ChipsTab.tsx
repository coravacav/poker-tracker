import { useRef, useState } from "react";
import { centsToInputValue, parseMoneyToCents } from "../../domain/money";
import type { Player, PlayerLedgerSummary } from "../../domain/pokerTypes";
import type { AgreementKind, AgreementProposal, SeatOption } from "../../session/types";
import { createId } from "../../state/seedGame";
import { useFormatCurrency } from "../CurrencyContext";
import { settleUpLine } from "./agreementText";
import type { ChipsDraft } from "./types";

/** The most one entry may be; the server refuses more. */
const MAX_ENTRY_CENTS = 1_000_000;
const FALLBACK_AMOUNTS = [500, 1000, 2000, 5000];

const kindLabels: Record<AgreementKind, string> = {
  give: "Give to",
  buy: "Buy from",
  bank: "From bank"
};

/** Half, one, and two default buy-ins, or $5 / $10 / $20 / $50 without one. */
export function chipsQuickAmounts(defaultBuyInCents: number): number[] {
  if (defaultBuyInCents <= 0) return FALLBACK_AMOUNTS;
  const amounts = [Math.round(defaultBuyInCents / 2), defaultBuyInCents, defaultBuyInCents * 2];
  return [...new Set(amounts.filter((cents) => cents > 0 && cents <= MAX_ENTRY_CENTS))];
}

type ChipsTabProps = {
  me: Player;
  players: Player[];
  summaryByPlayerId: Map<string, PlayerLedgerSummary>;
  seats: SeatOption[];
  defaultBuyInCents: number;
  ended: boolean;
  notice: string | null;
  initialDraft?: ChipsDraft | null;
  /** Resolves to whether the entry was sent. */
  onSend: (proposal: AgreementProposal & { clientRequestId: string }, draft: ChipsDraft) => Promise<boolean>;
  onAskHost: () => void;
};

/** Chips: Give to / Buy from another player, or From bank, sent to another phone to confirm. */
export function ChipsTab({
  me,
  players,
  summaryByPlayerId,
  seats,
  defaultBuyInCents,
  ended,
  notice,
  initialDraft,
  onSend,
  onAskHost
}: ChipsTabProps) {
  const formatCurrency = useFormatCurrency();
  const others = players.filter((player) => player.id !== me.id);
  const [kind, setKind] = useState<AgreementKind>(initialDraft?.kind ?? "give");
  const [counterpartyId, setCounterpartyId] = useState<string | null>(initialDraft?.counterpartyPlayerId ?? null);
  const [witnessId, setWitnessId] = useState<string | null>(initialDraft?.witnessPlayerId ?? null);
  const [amountInput, setAmountInput] = useState(
    initialDraft?.amountCents ? centsToInputValue(initialDraft.amountCents).replace(/\.00$/, "") : ""
  );
  const [sending, setSending] = useState(false);
  // One request id per draft, so a retry after a dropped reply can't send it twice.
  const requestRef = useRef<{ key: string; id: string } | null>(null);

  const quickAmounts = chipsQuickAmounts(defaultBuyInCents);
  const amountCents = amountInput.trim() === "" ? null : parseMoneyToCents(amountInput);
  const amountValid = amountCents !== null && amountCents > 0 && amountCents <= MAX_ENTRY_CENTS;
  const counterparty = kind === "bank" ? null : (others.find((player) => player.id === counterpartyId) ?? null);
  const witness = kind === "bank" ? (others.find((player) => player.id === witnessId) ?? null) : null;
  const ready = amountValid && (kind === "bank" || counterparty !== null) && !ended;
  const amount = amountValid ? formatCurrency(amountCents, { trimWholeCents: true }) : null;
  // A seat no phone holds (other than the host's own) is confirmed by the host.
  const counterpartySeat = counterparty ? seats.find((seat) => seat.playerId === counterparty.id) : undefined;
  const hostConfirms = counterpartySeat !== undefined && !counterpartySeat.claimed && !counterpartySeat.isHost;

  const summary = !amount
    ? kind === "bank"
      ? "Pick how much you bought in for."
      : "Pick who and how much."
    : kind === "bank"
      ? `You buy ${amount} in chips from the bank.`
      : !counterparty
        ? "Pick who."
        : kind === "give"
          ? `You give ${counterparty.name} ${amount} in chips. ${settleUpLine(
              { id: counterparty.id, name: counterparty.name },
              { id: me.id, name: me.name },
              amount,
              me.id
            )}`
          : `You get ${amount} in chips from ${counterparty.name}. ${settleUpLine(
              { id: me.id, name: me.name },
              { id: counterparty.id, name: counterparty.name },
              amount,
              me.id
            )}`;
  const sendLabel = kind === "bank"
    ? witness ? `Ask ${witness.name} to confirm` : "Ask for a witness"
    : counterparty ? `Send to ${counterparty.name} to confirm` : "Send to confirm";
  const hint = kind === "bank"
    ? witness
      ? `Nothing is recorded until ${witness.name} says they saw it.`
      : "Shows up in everyone's Inbox until someone taps I saw it."
    : !counterparty
      ? "Nothing is recorded until they confirm."
      : hostConfirms
        ? `${counterparty.name} has no phone here, so nothing is recorded until the host confirms.`
        : `Nothing is recorded until ${counterparty.name} confirms.`;

  async function send() {
    if (!ready || sending || amountCents === null) return;
    const proposal: AgreementProposal = {
      kind,
      amountCents,
      ...(kind === "bank"
        ? witness ? { witnessPlayerId: witness.id } : {}
        : { counterpartyPlayerId: counterparty!.id })
    };
    const key = JSON.stringify(proposal);
    if (requestRef.current?.key !== key) requestRef.current = { key, id: createId("chips") };
    setSending(true);
    const sent = await onSend(
      { ...proposal, clientRequestId: requestRef.current.id },
      {
        kind,
        amountCents,
        ...(proposal.counterpartyPlayerId ? { counterpartyPlayerId: proposal.counterpartyPlayerId } : {}),
        ...(proposal.witnessPlayerId ? { witnessPlayerId: proposal.witnessPlayerId } : {}),
        ...(initialDraft?.resendOf ? { resendOf: initialDraft.resendOf } : {})
      }
    );
    if (sent) requestRef.current = null;
    setSending(false);
  }

  function playerSub(player: Player): string {
    const netCents = summaryByPlayerId.get(player.id)?.netCents ?? 0;
    return netCents < 0 ? `In ${formatCurrency(-netCents, { trimWholeCents: true })}` : " ";
  }

  return (
    <div className="guest-tab guest-chips-tab">
      <div className="guest-tab-column">
        {notice ? <div className="notice notice-warning">{notice}</div> : null}
        {ended ? <div className="notice notice-info">The host ended this game.</div> : null}
        <div className="shape-segments guest-kind-segments" role="group" aria-label="Entry type">
          {(["give", "buy", "bank"] as const).map((option) => (
            <button key={option} type="button" aria-pressed={kind === option} onClick={() => setKind(option)}>
              {kindLabels[option]}
            </button>
          ))}
        </div>

        <section className="panel guest-chips-section" aria-labelledby="chips-who">
          {kind === "bank" ? (
            <>
              <div>
                <h2 id="chips-who">Who saw it?</h2>
                <p className="muted">Another player confirms they saw the buy-in.</p>
              </div>
              <div className="guest-player-grid" role="group" aria-label="Witness">
                <button
                  type="button"
                  className="guest-player-option is-wide"
                  aria-pressed={witness === null}
                  onClick={() => setWitnessId(null)}
                >
                  <span>Anyone at the table</span>
                </button>
                {others.map((player) => (
                  <button
                    key={player.id}
                    type="button"
                    className="guest-player-option"
                    aria-pressed={witness?.id === player.id}
                    onClick={() => setWitnessId(witness?.id === player.id ? null : player.id)}
                  >
                    <span>{player.name}</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <h2 id="chips-who">{kind === "give" ? "Give to who?" : "Buy from who?"}</h2>
              {others.length === 0 ? (
                <p className="muted">Nobody else is at the table yet.</p>
              ) : (
                <div className="guest-player-grid" role="group" aria-label="Player">
                  {others.map((player) => (
                    <button
                      key={player.id}
                      type="button"
                      className="guest-player-option"
                      aria-pressed={counterparty?.id === player.id}
                      onClick={() => setCounterpartyId(player.id)}
                    >
                      <span>{player.name}</span>
                      <small>{playerSub(player)}</small>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </section>

        <section className="panel guest-chips-section" aria-labelledby="chips-amount">
          <h2 id="chips-amount">How much?</h2>
          <label className="guest-amount-field">
            <span>Amount</span>
            <input
              aria-label="Amount"
              inputMode="decimal"
              placeholder="0"
              value={amountInput}
              onChange={(event) => setAmountInput(event.currentTarget.value)}
            />
          </label>
          {amountCents !== null && amountCents > MAX_ENTRY_CENTS ? (
            <span className="inline-error">Enter up to {formatCurrency(MAX_ENTRY_CENTS, { trimWholeCents: true })}; ask the host for more.</span>
          ) : null}
          <div className="guest-quick-amounts" role="group" aria-label="Quick amounts">
            {quickAmounts.map((cents) => (
              <button
                key={cents}
                type="button"
                aria-pressed={amountCents === cents}
                onClick={() => setAmountInput(centsToInputValue(cents).replace(/\.00$/, ""))}
              >
                {formatCurrency(cents, { trimWholeCents: true })}
              </button>
            ))}
          </div>
        </section>

        <p className="guest-chips-summary" aria-live="polite">{summary}</p>

        <div className="guest-chips-send">
          <button className="primary-button" type="button" disabled={!ready || sending} onClick={() => void send()}>
            {sending ? "Sending…" : sendLabel}
          </button>
          <p className="muted">{hint}</p>
        </div>

        <button className="guest-ask-host" type="button" onClick={onAskHost}>
          Something else? Ask the host
        </button>
      </div>
    </div>
  );
}
