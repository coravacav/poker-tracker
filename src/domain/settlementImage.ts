/**
 * What the shareable settlement picture shows (see
 * components/settlementPanel/settlementImage.ts, which draws it): payments
 * still to make, payments already made, and each player's result, in the
 * game's currency. Pure, so it can be tested without a canvas.
 */
import { formatCurrency } from "./money";
import type { Player, PlayerLedgerSummary, SettlementPin } from "./pokerTypes";
import { buildSettlementPlan, playerNameById } from "./settlement";

export type SettlementImageTone = "positive" | "negative" | "neutral";

export type SettlementImageModel = {
  title: string;
  /** Payments still to make, then those already made. */
  payments: Array<{ from: string; to: string; amount: string; paid: boolean }>;
  /** Players by result, biggest win first. */
  results: Array<{ name: string; amount: string; tone: SettlementImageTone }>;
  /** Shown when there are no payments. */
  paymentsNote: string | null;
  footer: string;
};

export function buildSettlementImageModel(
  gameName: string,
  players: Player[],
  summaries: PlayerLedgerSummary[],
  pins: readonly SettlementPin[],
  { currencyCode = "USD", locale, date = new Date() }: { currencyCode?: string; locale?: string; date?: Date } = {}
): SettlementImageModel {
  const format = (cents: number) => formatCurrency(cents, currencyCode, locale ? { locale } : {});
  const plan = buildSettlementPlan(summaries, pins);
  const ordered = [
    ...plan.payments.filter((payment) => payment.status !== "paid"),
    ...plan.payments.filter((payment) => payment.status === "paid")
  ];
  const listed = summaries.filter((summary) => players.some((player) => player.id === summary.playerId));
  return {
    title: gameName.trim() || "Poker Night",
    payments: ordered.map((payment) => ({
      from: playerNameById(players, payment.fromPlayerId),
      to: playerNameById(players, payment.toPlayerId),
      amount: format(payment.amountCents),
      paid: payment.status === "paid"
    })),
    results: [...listed]
      .sort((left, right) => right.netCents - left.netCents)
      .map((summary) => ({
        name: playerNameById(players, summary.playerId),
        amount: `${summary.netCents > 0 ? "+" : ""}${format(summary.netCents)}`,
        tone: summary.netCents > 0 ? "positive" : summary.netCents < 0 ? "negative" : "neutral"
      })),
    paymentsNote: plan.payments.length === 0 ? "No payments between players needed." : null,
    footer: `Poker Tracker · ${new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date)}`
  };
}
