/**
 * How long a player sat in a game, estimated from the ledger's timestamps, and
 * results per hour built on it. Nothing here is a clock: games only record when
 * money moved, so the estimate is the span from a player's first buy-in to
 * their last cash-out.
 */
import { getActiveTransactions } from "./ledger";
import type { GameState, PlayerId, Transaction } from "./pokerTypes";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * Spans outside these bounds are treated as unknown rather than counted: a game
 * typed in after the fact has every entry within moments, and one cashed out
 * the next morning (or left open) would swamp everyone's per-hour rate.
 */
export const MIN_SESSION_MS = 15 * MINUTE_MS;
export const MAX_SESSION_MS = 24 * HOUR_MS;

/**
 * When a transaction was really recorded. A correction (a recounted cash-out,
 * or an entry flipped to the other direction) is entered later but stands for
 * the entry it fixes, so it takes that entry's time, following chains of fixes.
 */
function recordedAtMs(transaction: Transaction, byId: Map<string, Transaction>): number {
  let current = transaction;
  const seen = new Set<string>();
  while (!seen.has(current.id)) {
    seen.add(current.id);
    const originalId = current.correctsTransactionId ?? current.flippedFromTransactionId;
    if (!originalId) break;
    const original = byId.get(originalId);
    if (!original) break;
    current = original;
  }
  return Date.parse(current.createdAt);
}

/**
 * Milliseconds from the player's first buy-in to their last cash-out, or null
 * when the game cannot tell: no buy-in, no cash-out, unreadable times, or a
 * span outside MIN_SESSION_MS..MAX_SESSION_MS.
 */
export function playerSessionMs(state: Pick<GameState, "transactions">, playerId: PlayerId): number | null {
  const byId = new Map(state.transactions.map((transaction) => [transaction.id, transaction]));
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  for (const transaction of getActiveTransactions(state.transactions)) {
    if (transaction.type === "bank_buy_in" && transaction.toPlayerId === playerId) {
      const ms = recordedAtMs(transaction, byId);
      if (Number.isFinite(ms)) start = Math.min(start, ms);
    } else if (transaction.type === "bank_cash_out" && transaction.fromPlayerId === playerId) {
      const ms = recordedAtMs(transaction, byId);
      if (Number.isFinite(ms)) end = Math.max(end, ms);
    }
  }
  const span = end - start;
  return Number.isFinite(span) && span >= MIN_SESSION_MS && span <= MAX_SESSION_MS ? span : null;
}

export type HourlyResult = {
  /** Games with a known session length. */
  timedGames: number;
  /** Their summed session lengths. */
  timedMs: number;
  /** Their summed net result divided by their hours, rounded to whole cents; null with no timed games. */
  perHourCents: number | null;
};

/** Results per hour across games; games without a known length are left out of both sides. */
export function hourlyResult(results: Array<{ netCents: number; durationMs: number | null }>): HourlyResult {
  let timedGames = 0;
  let timedMs = 0;
  let timedNetCents = 0;
  for (const result of results) {
    if (result.durationMs === null) continue;
    timedGames += 1;
    timedMs += result.durationMs;
    timedNetCents += result.netCents;
  }
  return {
    timedGames,
    timedMs,
    // `|| 0` turns a rounded -0 (a tiny loss) into 0, so it never shows as "-$0.00".
    perHourCents: timedGames > 0 ? Math.round((timedNetCents * HOUR_MS) / timedMs) || 0 : null
  };
}

/** "45 min", "3 h", "3 h 20 min", rounded to the nearest 5 minutes (minimum 5). */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.max(5, Math.round(ms / (5 * MINUTE_MS)) * 5);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

/** Hours with one decimal, for totals ("14.5"). */
export function formatHours(ms: number): string {
  return (Math.round((ms / HOUR_MS) * 10) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 });
}
