import type {
  Player,
  PlayerId,
  PlayerLedgerSummary,
  SettlementPayment,
  SettlementPin,
  SettlementPinStatus
} from "./pokerTypes";

/** Only the fields settlement needs, so callers can pass adjusted balances. */
export type SettlementBalance = Pick<PlayerLedgerSummary, "playerId" | "netCents">;

/**
 * Leftover balances (after exact pairs) up to this count are partitioned
 * exactly with a subset DP, which costs about 2^n * n steps (~5M at 18, a few ms on desktop).
 */
export const EXACT_SETTLEMENT_MAX_BALANCES = 18;
/** Combinations the small-group search may check before settling for greedy. */
const SMALL_GROUP_SEARCH_BUDGET = 200_000;
const MAX_SMALL_GROUP_SIZE = 6;
/** Shared rooms allow 24 players; this leaves room for corrections. */
export const MAX_SETTLEMENT_PINS = 100;
const MAX_SETTLEMENT_PIN_ID_LENGTH = 120;

type Balance = { playerId: PlayerId; cents: number; order: number };

function byMagnitude(left: Balance, right: Balance): number {
  return Math.abs(right.cents) - Math.abs(left.cents) || left.order - right.order;
}

/** Pairs the largest remaining debtor with the largest remaining creditor. */
function greedySettle(balances: Balance[]): SettlementPayment[] {
  const debtors = balances
    .filter((balance) => balance.cents < 0)
    .map((balance) => ({ ...balance, remainingCents: -balance.cents }))
    .sort((a, b) => b.remainingCents - a.remainingCents || a.order - b.order);
  const creditors = balances
    .filter((balance) => balance.cents > 0)
    .map((balance) => ({ ...balance, remainingCents: balance.cents }))
    .sort((a, b) => b.remainingCents - a.remainingCents || a.order - b.order);

  const payments: SettlementPayment[] = [];
  let debtorIndex = 0;
  let creditorIndex = 0;

  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const amountCents = Math.min(debtor.remainingCents, creditor.remainingCents);

    if (amountCents > 0) {
      payments.push({
        fromPlayerId: debtor.playerId,
        toPlayerId: creditor.playerId,
        amountCents
      });
    }

    debtor.remainingCents -= amountCents;
    creditor.remainingCents -= amountCents;

    if (debtor.remainingCents === 0) debtorIndex += 1;
    if (creditor.remainingCents === 0) creditorIndex += 1;
  }

  return payments;
}

/**
 * Matching x with -x never costs optimality: in any optimal partition into
 * zero-sum groups, {x, -x} can be split out without reducing the group count.
 */
function extractExactPairs(balances: Balance[]): { groups: Balance[][]; rest: Balance[] } {
  const creditorsByAmount = new Map<number, Balance[]>();
  for (const balance of balances) {
    if (balance.cents <= 0) continue;
    const queue = creditorsByAmount.get(balance.cents) ?? [];
    queue.push(balance);
    creditorsByAmount.set(balance.cents, queue);
  }

  const groups: Balance[][] = [];
  const used = new Set<Balance>();
  for (const debtor of balances) {
    if (debtor.cents >= 0) continue;
    const creditor = creditorsByAmount.get(-debtor.cents)?.shift();
    if (!creditor) continue;
    used.add(debtor);
    used.add(creditor);
    groups.push([debtor, creditor]);
  }

  return { groups, rest: balances.filter((balance) => !used.has(balance)) };
}

/** First zero-sum subset of exactly `size` values in index order, within budget. */
function findZeroSumSubset(
  values: number[],
  size: number,
  budget: { remaining: number }
): number[] | null {
  const indexesByValue = new Map<number, number[]>();
  values.forEach((value, index) => {
    const indexes = indexesByValue.get(value) ?? [];
    indexes.push(index);
    indexesByValue.set(value, indexes);
  });

  const chosen: number[] = [];
  function search(start: number, sum: number): boolean {
    if (chosen.length === size - 1) {
      budget.remaining -= 1;
      const last = indexesByValue.get(-sum)?.find((index) => index >= start);
      if (last === undefined) return false;
      chosen.push(last);
      return true;
    }
    const lastStart = values.length - (size - chosen.length);
    for (let index = start; index <= lastStart; index += 1) {
      if (budget.remaining <= 0) return false;
      chosen.push(index);
      if (search(index + 1, sum + values[index])) return true;
      chosen.pop();
    }
    return false;
  }

  return search(0, 0) ? chosen : null;
}

/**
 * Splits a zero-sum set into the most zero-sum groups. dp[mask] is the most
 * zero-sum prefixes reachable when removing the mask's members one at a time;
 * the zero-sum masks along the best removal order mark the group boundaries.
 */
function partitionExactly(balances: Balance[]): Balance[][] {
  const count = balances.length;
  if (count === 0) return [];
  const maskCount = 1 << count;
  const sums = new Float64Array(maskCount);
  const best = new Int8Array(maskCount);

  for (let mask = 1; mask < maskCount; mask += 1) {
    const lowBit = mask & -mask;
    sums[mask] = sums[mask ^ lowBit] + balances[31 - Math.clz32(lowBit)].cents;
    let most = 0;
    for (let bits = mask; bits !== 0; bits &= bits - 1) {
      const candidate = best[mask ^ (bits & -bits)];
      if (candidate > most) most = candidate;
    }
    best[mask] = most + (sums[mask] === 0 ? 1 : 0);
  }

  const groups: Balance[][] = [];
  let group: Balance[] = [];
  let mask = maskCount - 1;
  while (mask !== 0) {
    const target = best[mask] - (sums[mask] === 0 ? 1 : 0);
    let index = 0;
    while (!((mask >> index) & 1) || best[mask ^ (1 << index)] !== target) index += 1;
    group.push(balances[index]);
    mask ^= 1 << index;
    if (sums[mask] === 0) {
      groups.push(group);
      group = [];
    }
  }

  return groups;
}

/** Splits a zero-sum set into zero-sum groups; exact when it is small enough. */
function partitionIntoZeroSumGroups(balances: Balance[]): Balance[][] {
  const { groups, rest: afterPairs } = extractExactPairs([...balances].sort(byMagnitude));
  let rest = afterPairs;

  // Too many for the exact DP: peel off the smallest zero-sum groups found.
  const budget = { remaining: SMALL_GROUP_SEARCH_BUDGET };
  search: while (rest.length > EXACT_SETTLEMENT_MAX_BALANCES && budget.remaining > 0) {
    const values = rest.map((balance) => balance.cents);
    const largestSize = Math.min(MAX_SMALL_GROUP_SIZE, Math.floor(rest.length / 2));
    for (let size = 3; size <= largestSize; size += 1) {
      const found = findZeroSumSubset(values, size, budget);
      if (found) {
        const foundIndexes = new Set(found);
        groups.push(found.map((index) => rest[index]));
        rest = rest.filter((_, index) => !foundIndexes.has(index));
        continue search;
      }
    }
    break;
  }

  if (rest.length <= EXACT_SETTLEMENT_MAX_BALANCES) {
    groups.push(...partitionExactly(rest));
  } else {
    groups.push(rest);
  }
  return groups;
}

function toBalances(summaries: readonly SettlementBalance[]): Balance[] {
  return summaries
    .map((summary, order) => ({ playerId: summary.playerId, cents: summary.netCents, order }))
    .filter((balance) => balance.cents !== 0);
}

/** Biggest debtor first, then larger amounts, then biggest creditor. */
function sortPayments<T extends SettlementPayment>(
  payments: T[],
  summaries: readonly SettlementBalance[]
): T[] {
  const rankById = new Map<PlayerId, { cents: number; order: number }>();
  summaries.forEach((summary, order) => {
    if (!rankById.has(summary.playerId)) {
      rankById.set(summary.playerId, { cents: summary.netCents, order });
    }
  });
  const rank = (playerId: PlayerId) =>
    rankById.get(playerId) ?? { cents: 0, order: Number.MAX_SAFE_INTEGER };

  return [...payments].sort((left, right) => {
    const leftFrom = rank(left.fromPlayerId);
    const rightFrom = rank(right.fromPlayerId);
    const leftTo = rank(left.toPlayerId);
    const rightTo = rank(right.toPlayerId);
    return (
      leftFrom.cents - rightFrom.cents ||
      leftFrom.order - rightFrom.order ||
      right.amountCents - left.amountCents ||
      rightTo.cents - leftTo.cents ||
      leftTo.order - rightTo.order
    );
  });
}

/**
 * Fewest payments that settle every balance. A zero-sum set of n balances
 * split into g zero-sum groups needs n - g payments, so this maximizes the
 * number of groups: exact x/-x pairs first, then an exact subset DP when few
 * balances remain, or a budgeted small-group search when many do. The result
 * is never longer than the largest-debtor-first greedy plan, and identical
 * input always gives identical output.
 */
export function buildMinimizedSettlement(
  summaries: readonly SettlementBalance[]
): SettlementPayment[] {
  const balances = toBalances(summaries);
  const greedy = greedySettle(balances);
  const totalCents = balances.reduce((total, balance) => total + balance.cents, 0);

  // An unbalanced ledger (chips still out) cannot be fully settled; keep greedy.
  if (totalCents !== 0 || !balances.every((balance) => Number.isSafeInteger(balance.cents))) {
    return sortPayments(greedy, summaries);
  }

  const optimized = partitionIntoZeroSumGroups(balances).flatMap(greedySettle);
  return sortPayments(optimized.length <= greedy.length ? optimized : greedy, summaries);
}

export type SettlementPlanPayment = SettlementPayment & {
  status: "suggested" | SettlementPinStatus;
  /** Set for pinned payments. */
  pinId?: string;
};

export type SettlementPlan = {
  payments: SettlementPlanPayment[];
  paidCount: number;
  /** Players the pinned payments overshoot: debtors who end up owed, or the reverse. */
  overpinnedPlayerIds: PlayerId[];
};

function isSettlementPinStatus(value: unknown): value is SettlementPinStatus {
  return value === "locked" || value === "paid";
}

/** Structural check only; see sanitizeSettlementPins for player references. */
export function isWellFormedSettlementPin(value: unknown): value is SettlementPin {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SettlementPin>;
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    candidate.id.length <= MAX_SETTLEMENT_PIN_ID_LENGTH &&
    typeof candidate.fromPlayerId === "string" &&
    candidate.fromPlayerId.length > 0 &&
    typeof candidate.toPlayerId === "string" &&
    candidate.toPlayerId.length > 0 &&
    candidate.fromPlayerId !== candidate.toPlayerId &&
    typeof candidate.amountCents === "number" &&
    Number.isSafeInteger(candidate.amountCents) &&
    candidate.amountCents > 0 &&
    isSettlementPinStatus(candidate.status)
  );
}

/**
 * Keeps the pins this build understands, for players that exist, without
 * duplicate ids, copying only known fields. Unknown values (for example from
 * a newer build) are dropped rather than rejecting the whole game.
 */
export function sanitizeSettlementPins(value: unknown, players: readonly Player[]): SettlementPin[] {
  if (!Array.isArray(value)) return [];
  const playerIds = new Set(players.map((player) => player.id));
  const seenIds = new Set<string>();
  const pins: SettlementPin[] = [];
  for (const candidate of value) {
    if (
      pins.length >= MAX_SETTLEMENT_PINS ||
      !isWellFormedSettlementPin(candidate) ||
      seenIds.has(candidate.id) ||
      !playerIds.has(candidate.fromPlayerId) ||
      !playerIds.has(candidate.toPlayerId)
    ) {
      continue;
    }
    seenIds.add(candidate.id);
    const { id, fromPlayerId, toPlayerId, amountCents, status } = candidate;
    pins.push({ id, fromPlayerId, toPlayerId, amountCents, status });
  }
  return pins;
}

/**
 * Pinned payments stay as they are; the fewest remaining payments are
 * computed on what is left of each balance after them.
 */
export function buildSettlementPlan(
  summaries: readonly SettlementBalance[],
  pins: readonly SettlementPin[] = []
): SettlementPlan {
  const usablePins = pins.filter(isWellFormedSettlementPin);
  const originalCents = new Map<PlayerId, number>();
  for (const summary of summaries) {
    originalCents.set(summary.playerId, (originalCents.get(summary.playerId) ?? 0) + summary.netCents);
  }
  const residualCents = new Map(originalCents);
  for (const pin of usablePins) {
    residualCents.set(pin.fromPlayerId, (residualCents.get(pin.fromPlayerId) ?? 0) + pin.amountCents);
    residualCents.set(pin.toPlayerId, (residualCents.get(pin.toPlayerId) ?? 0) - pin.amountCents);
  }

  const remaining = buildMinimizedSettlement(
    [...residualCents].map(([playerId, netCents]) => ({ playerId, netCents }))
  );
  const payments: SettlementPlanPayment[] = [
    ...usablePins.map(({ id, fromPlayerId, toPlayerId, amountCents, status }) => ({
      fromPlayerId,
      toPlayerId,
      amountCents,
      status,
      pinId: id
    })),
    ...remaining.map((payment) => ({ ...payment, status: "suggested" as const }))
  ];
  const overpinnedPlayerIds = [...residualCents]
    .filter(([playerId, residual]) => {
      const original = originalCents.get(playerId) ?? 0;
      return (original <= 0 && residual > 0) || (original >= 0 && residual < 0);
    })
    .map(([playerId]) => playerId);

  return {
    // Ordered by the original balances so rows stay put as payments get pinned;
    // the stable sort keeps pins ahead of an identical suggestion.
    payments: sortPayments(payments, summaries),
    paidCount: usablePins.filter((pin) => pin.status === "paid").length,
    overpinnedPlayerIds
  };
}

export function filterSettlementSummariesForDisplay(
  players: Player[],
  summaries: PlayerLedgerSummary[]
): PlayerLedgerSummary[] {
  const activePlayerIds = new Set(
    players.filter((player) => player.isActive).map((player) => player.id)
  );

  return summaries.filter(
    (summary) => activePlayerIds.has(summary.playerId) || summary.netCents !== 0
  );
}

export function playerNameById(players: Player[], playerId: string): string {
  return players.find((player) => player.id === playerId)?.name ?? "Unknown player";
}

function formatSummaryAmount(amountCents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(amountCents / 100);
}

export function buildSettlementSummaryText(
  gameName: string,
  players: Player[],
  summaries: PlayerLedgerSummary[],
  pins: readonly SettlementPin[] = []
): string {
  const plan = buildSettlementPlan(summaries, pins);
  const outstanding = plan.payments.filter((payment) => payment.status !== "paid");
  const paid = plan.payments.filter((payment) => payment.status === "paid");
  const sortedSummaries = [...summaries].sort(
    (left, right) => right.netCents - left.netCents
  );
  const lines = [gameName.trim() || "Poker Night", "", "Final results"];

  for (const summary of sortedSummaries) {
    const prefix = summary.netCents > 0 ? "+" : "";
    lines.push(
      `${playerNameById(players, summary.playerId)}: ${prefix}${formatSummaryAmount(summary.netCents)}`
    );
  }

  lines.push("", "Payments");
  if (plan.payments.length === 0) {
    lines.push("No player-to-player payments needed.");
  } else if (outstanding.length === 0) {
    lines.push("All payments are settled.");
  } else {
    for (const payment of outstanding) {
      lines.push(
        `${playerNameById(players, payment.fromPlayerId)} pays ${playerNameById(players, payment.toPlayerId)} ${formatSummaryAmount(payment.amountCents)}`
      );
    }
  }

  if (paid.length > 0) {
    lines.push("", "Already paid");
    for (const payment of paid) {
      lines.push(
        `${playerNameById(players, payment.fromPlayerId)} paid ${playerNameById(players, payment.toPlayerId)} ${formatSummaryAmount(payment.amountCents)}`
      );
    }
  }

  return lines.join("\n");
}
