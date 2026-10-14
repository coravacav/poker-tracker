import { describe, expect, it } from "vitest";
import type { PlayerLedgerSummary, SettlementPayment, SettlementPin } from "../domain/pokerTypes";
import {
  EXACT_SETTLEMENT_MAX_BALANCES,
  buildMinimizedSettlement,
  buildSettlementPlan,
  buildSettlementSummaryText,
  filterSettlementSummariesForDisplay,
  sanitizeSettlementPins
} from "../domain/settlement";

function summary(playerId: string, netCents: number): PlayerLedgerSummary {
  return {
    playerId,
    bankBuyInsCents: 0,
    bankCashOutsCents: 0,
    sentToPlayersCents: 0,
    receivedFromPlayersCents: 0,
    owedToPlayersCents: 0,
    owedByPlayersCents: 0,
    debtCoveredByOthersCents: 0,
    debtCoveredForOthersCents: 0,
    netCents
  };
}

describe("settlement", () => {
  it("creates a single payment for one debtor and one creditor", () => {
    expect(buildMinimizedSettlement([summary("a", -2000), summary("b", 2000)])).toEqual([
      {
        fromPlayerId: "a",
        toPlayerId: "b",
        amountCents: 2000
      }
    ]);
  });

  it("minimizes multiple debtors and creditors", () => {
    expect(
      buildMinimizedSettlement([
        summary("alex", -3000),
        summary("blair", -1000),
        summary("casey", 2500),
        summary("drew", 1500)
      ])
    ).toEqual([
      { fromPlayerId: "alex", toPlayerId: "casey", amountCents: 2500 },
      { fromPlayerId: "alex", toPlayerId: "drew", amountCents: 500 },
      { fromPlayerId: "blair", toPlayerId: "drew", amountCents: 1000 }
    ]);
  });

  it("hides inactive zero-balance players from live settlement display", () => {
    const players = [
      { id: "active", name: "Active", seatIndex: 0, isActive: true },
      { id: "empty-archived", name: "Empty Archived", seatIndex: 1, isActive: false },
      { id: "owed-archived", name: "Owed Archived", seatIndex: 2, isActive: false }
    ];

    expect(
      filterSettlementSummariesForDisplay(players, [
        summary("active", 0),
        summary("empty-archived", 0),
        summary("owed-archived", 500)
      ]).map((visibleSummary) => visibleSummary.playerId)
    ).toEqual(["active", "owed-archived"]);
  });

  it("builds a shareable final-results and payment summary", () => {
    const players = [
      { id: "alex", name: "Alex", seatIndex: 0, isActive: true },
      { id: "blair", name: "Blair", seatIndex: 1, isActive: true }
    ];

    expect(
      buildSettlementSummaryText("Friday Night", players, [
        summary("alex", -2000),
        summary("blair", 2000)
      ])
    ).toBe(
      "Friday Night\n\nFinal results\nBlair: +$20.00\nAlex: -$20.00\n\nPayments\nAlex pays Blair $20.00"
    );
  });
});

type Balance = { playerId: string; netCents: number };

function balances(values: number[]): Balance[] {
  return values.map((netCents, index) => ({ playerId: `p${index}`, netCents }));
}

/** The previous largest-debtor-first algorithm, as a reference. */
function greedyPaymentCount(input: Balance[]): number {
  const debtors = input.filter((b) => b.netCents < 0).map((b) => -b.netCents).sort((a, b) => b - a);
  const creditors = input.filter((b) => b.netCents > 0).map((b) => b.netCents).sort((a, b) => b - a);
  let count = 0;
  let d = 0;
  let c = 0;
  while (d < debtors.length && c < creditors.length) {
    const amount = Math.min(debtors[d], creditors[c]);
    if (amount > 0) count += 1;
    debtors[d] -= amount;
    creditors[c] -= amount;
    if (debtors[d] === 0) d += 1;
    if (creditors[c] === 0) c += 1;
  }
  return count;
}

/** Independent brute force: nonzero count minus the most disjoint zero-sum groups. */
function optimalPaymentCount(values: number[]): number {
  const nonzero = values.filter((value) => value !== 0);
  const memo = new Map<string, number>();
  function mostGroups(remaining: number[]): number {
    if (remaining.length === 0) return 0;
    const key = remaining.join(",");
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    const [first, ...others] = remaining;
    let best = 0;
    // Choose the group containing `first`: any subset of the others summing to -first.
    for (let mask = 0; mask < 1 << others.length; mask += 1) {
      let sum = first;
      const rest: number[] = [];
      others.forEach((value, index) => {
        if (mask & (1 << index)) sum += value;
        else rest.push(value);
      });
      if (sum === 0) best = Math.max(best, 1 + mostGroups(rest));
    }
    memo.set(key, best);
    return best;
  }
  return nonzero.length - mostGroups(nonzero);
}

function applyPayments(input: Balance[], payments: SettlementPayment[]): Map<string, number> {
  const result = new Map(input.map((b) => [b.playerId, b.netCents]));
  for (const payment of payments) {
    result.set(payment.fromPlayerId, (result.get(payment.fromPlayerId) ?? 0) + payment.amountCents);
    result.set(payment.toPlayerId, (result.get(payment.toPlayerId) ?? 0) - payment.amountCents);
  }
  return result;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function randomZeroSumBalances(random: () => number, count: number, stepCents: number, maxSteps: number): Balance[] {
  const values = Array.from({ length: count - 1 }, () => {
    const steps = 1 + Math.floor(random() * maxSteps);
    return (random() < 0.5 ? -1 : 1) * steps * stepCents;
  });
  values.push(-values.reduce((total, value) => total + value, 0));
  return balances(values);
}

describe("minimized settlement", () => {
  it("settles two debtors and two matching creditors in two payments", () => {
    const input = [summary("a", -3000), summary("b", -2000), summary("c", 2000), summary("d", 3000)];
    expect(buildMinimizedSettlement(input)).toEqual([
      { fromPlayerId: "a", toPlayerId: "d", amountCents: 3000 },
      { fromPlayerId: "b", toPlayerId: "c", amountCents: 2000 }
    ]);
  });

  it("matches exact amounts that largest-first greedy splits", () => {
    // Greedy pays 30 -> 25 first and ends with four payments; optimal is three.
    const input = [
      summary("a", -3000),
      summary("b", -2000),
      summary("c", 2500),
      summary("d", 2000),
      summary("e", 500)
    ];
    expect(greedyPaymentCount(input)).toBe(4);
    expect(buildMinimizedSettlement(input)).toEqual([
      { fromPlayerId: "a", toPlayerId: "c", amountCents: 2500 },
      { fromPlayerId: "a", toPlayerId: "e", amountCents: 500 },
      { fromPlayerId: "b", toPlayerId: "d", amountCents: 2000 }
    ]);
  });

  it("finds zero-sum groups larger than pairs that greedy misses", () => {
    // {-2, -6, +8} and {-5, -7, +12}: four payments; greedy needs five.
    const input = balances([-200, -500, -600, -700, 800, 1200]);
    expect(greedyPaymentCount(input)).toBe(5);
    const payments = buildMinimizedSettlement(input);
    expect(payments).toHaveLength(4);
    expect([...applyPayments(input, payments).values()].every((value) => value === 0)).toBe(true);
  });

  it("keeps the greedy result when the ledger does not balance", () => {
    expect(buildMinimizedSettlement([summary("a", -3000), summary("b", 2000)])).toEqual([
      { fromPlayerId: "a", toPlayerId: "b", amountCents: 2000 }
    ]);
  });

  it("returns no payments when everyone is even", () => {
    expect(buildMinimizedSettlement([summary("a", 0), summary("b", 0)])).toEqual([]);
  });

  it("is optimal, conserving, and deterministic on random small games", () => {
    const random = seededRandom(7);
    for (let round = 0; round < 300; round += 1) {
      const count = 2 + Math.floor(random() * 9);
      // Coarse steps create many coincidental zero-sum groups.
      const input = randomZeroSumBalances(random, count, 500, 6);
      const payments = buildMinimizedSettlement(input);

      expect(payments.length).toBe(optimalPaymentCount(input.map((b) => b.netCents)));
      expect(payments.length).toBeLessThanOrEqual(greedyPaymentCount(input));
      expect([...applyPayments(input, payments).values()].every((value) => value === 0)).toBe(true);
      for (const payment of payments) {
        expect(payment.fromPlayerId).not.toBe(payment.toPlayerId);
        expect(Number.isSafeInteger(payment.amountCents)).toBe(true);
        expect(payment.amountCents).toBeGreaterThan(0);
      }
      expect(buildMinimizedSettlement(input.map((b) => ({ ...b })))).toEqual(payments);
    }
  });

  it("stays valid and never worse than greedy on random games up to 24 players", () => {
    const random = seededRandom(2026);
    for (let round = 0; round < 200; round += 1) {
      const count = 2 + Math.floor(random() * 23);
      const input =
        round % 2 === 0
          ? randomZeroSumBalances(random, count, 100, 40)
          : randomZeroSumBalances(random, count, 1, 50_000);
      const payments = buildMinimizedSettlement(input);
      const nonzero = input.filter((b) => b.netCents !== 0).length;

      expect(payments.length).toBeLessThanOrEqual(greedyPaymentCount(input));
      expect(payments.length).toBeLessThanOrEqual(Math.max(0, nonzero - 1));
      expect([...applyPayments(input, payments).values()].every((value) => value === 0)).toBe(true);
      expect(payments.every((payment) => payment.fromPlayerId !== payment.toPlayerId)).toBe(true);
      expect(buildMinimizedSettlement(input)).toEqual(payments);
    }
  });

  it("settles 24 players quickly even without small zero-sum groups", () => {
    const random = seededRandom(99);
    let slowestMs = 0;
    for (let round = 0; round < 25; round += 1) {
      // Arbitrary cents make small zero-sum groups rare, the slowest path.
      const input = randomZeroSumBalances(random, 24, 1, 100_000);
      const started = performance.now();
      const payments = buildMinimizedSettlement(input);
      slowestMs = Math.max(slowestMs, performance.now() - started);
      expect([...applyPayments(input, payments).values()].every((value) => value === 0)).toBe(true);
    }
    // Typically a few milliseconds; the bound only guards against blowups.
    expect(slowestMs).toBeLessThan(250);
  });

  it("finds small groups among 24 players, beyond the exact partition limit", () => {
    // Eight planted triples (-a, -b, a + b) and no x/-x pairs: optimal is 16 payments.
    const values: number[] = [];
    for (let index = 0; index < 8; index += 1) {
      const a = 1000 + index * 137;
      const b = 3000 + index * 211;
      values.push(-a, -b, a + b);
    }
    const input = balances(values);
    const payments = buildMinimizedSettlement(input);
    expect(payments).toHaveLength(16);
    expect([...applyPayments(input, payments).values()].every((value) => value === 0)).toBe(true);
  });

  it("uses the exact partition right up to its size limit", () => {
    const random = seededRandom(5);
    for (let round = 0; round < 3; round += 1) {
      const input = randomZeroSumBalances(random, EXACT_SETTLEMENT_MAX_BALANCES, 500, 4);
      const started = performance.now();
      const payments = buildMinimizedSettlement(input);
      expect(performance.now() - started).toBeLessThan(250);
      expect(payments.length).toBeLessThanOrEqual(greedyPaymentCount(input));
    }
  });
});

describe("settlement pins", () => {
  const players = [
    { id: "alex", name: "Alex", seatIndex: 0, isActive: true },
    { id: "blair", name: "Blair", seatIndex: 1, isActive: true },
    { id: "casey", name: "Casey", seatIndex: 2, isActive: true }
  ];
  const nets = [summary("alex", -3000), summary("blair", 1000), summary("casey", 2000)];

  function pin(
    id: string,
    fromPlayerId: string,
    toPlayerId: string,
    amountCents: number,
    status: SettlementPin["status"]
  ): SettlementPin {
    return { id, fromPlayerId, toPlayerId, amountCents, status };
  }

  it("keeps pinned payments and settles the rest around them", () => {
    // Alex already paid Blair everything, so Blair now owes Casey.
    const plan = buildSettlementPlan(nets, [pin("p1", "alex", "blair", 3000, "paid")]);
    expect(plan.payments).toEqual([
      { fromPlayerId: "alex", toPlayerId: "blair", amountCents: 3000, status: "paid", pinId: "p1" },
      { fromPlayerId: "blair", toPlayerId: "casey", amountCents: 2000, status: "suggested" }
    ]);
    expect(plan.paidCount).toBe(1);
    expect(plan.overpinnedPlayerIds).toEqual(["blair"]);
  });

  it("marks a suggested payment paid without changing the others", () => {
    const before = buildSettlementPlan(nets);
    const target = before.payments[0];
    const after = buildSettlementPlan(nets, [
      pin("p1", target.fromPlayerId, target.toPlayerId, target.amountCents, "paid")
    ]);
    expect(after.payments.map(({ fromPlayerId, toPlayerId, amountCents }) => ({ fromPlayerId, toPlayerId, amountCents })))
      .toEqual(before.payments.map(({ fromPlayerId, toPlayerId, amountCents }) => ({ fromPlayerId, toPlayerId, amountCents })));
    expect(after.payments.map((payment) => payment.status)).toEqual(["paid", "suggested"]);
    expect(after.overpinnedPlayerIds).toEqual([]);
  });

  it("plans around a locked partial payment", () => {
    const plan = buildSettlementPlan(nets, [pin("p1", "alex", "casey", 500, "locked")]);
    const remaining = plan.payments.filter((payment) => payment.status === "suggested");
    expect(remaining.reduce((total, payment) => total + payment.amountCents, 0)).toBe(2500);
    expect(applyPayments(nets, plan.payments).get("alex")).toBe(0);
    expect([...applyPayments(nets, plan.payments).values()].every((value) => value === 0)).toBe(true);
    expect(plan.paidCount).toBe(0);
  });

  it("ignores malformed pins", () => {
    const plan = buildSettlementPlan(nets, [
      pin("self", "alex", "alex", 500, "paid"),
      pin("zero", "alex", "blair", 0, "paid"),
      { ...pin("future", "alex", "blair", 500, "paid"), status: "disputed" as never }
    ]);
    expect(plan.payments.every((payment) => payment.status === "suggested")).toBe(true);
  });

  it("sanitizes stored pins against the roster", () => {
    expect(
      sanitizeSettlementPins(
        [
          pin("ok", "alex", "blair", 500, "paid"),
          { ...pin("extra", "alex", "casey", 500, "locked"), note: "drop me" },
          pin("ok", "alex", "casey", 700, "paid"),
          pin("ghost", "alex", "nobody", 500, "paid"),
          "junk"
        ],
        players
      )
    ).toEqual([pin("ok", "alex", "blair", 500, "paid"), pin("extra", "alex", "casey", 500, "locked")]);
    expect(sanitizeSettlementPins(undefined, players)).toEqual([]);
  });

  it("lists paid payments separately in the shareable summary", () => {
    expect(
      buildSettlementSummaryText("Friday Night", players, nets, [
        pin("p1", "alex", "casey", 2000, "paid"),
        pin("p2", "alex", "blair", 1000, "locked")
      ])
    ).toBe(
      [
        "Friday Night",
        "",
        "Final results",
        "Casey: +$20.00",
        "Blair: +$10.00",
        "Alex: -$30.00",
        "",
        "Payments",
        "Alex pays Blair $10.00",
        "",
        "Already paid",
        "Alex paid Casey $20.00"
      ].join("\n")
    );
  });

  it("says when every payment is settled", () => {
    expect(
      buildSettlementSummaryText("Friday Night", players, nets, [
        pin("p1", "alex", "casey", 2000, "paid"),
        pin("p2", "alex", "blair", 1000, "paid")
      ])
    ).toContain("Payments\nAll payments are settled.\n\nAlready paid\nAlex paid Casey $20.00\nAlex paid Blair $10.00");
  });
});
