import { describe, expect, it } from "vitest";
import {
  buildPlayerSummaries,
  calculateBankSummary,
  calculateLedgerImbalanceCents
} from "../domain/ledger";
import type { Player, Transaction } from "../domain/pokerTypes";

const players: Player[] = [
  { id: "alex", name: "Alex", seatIndex: 0, isActive: true },
  { id: "blair", name: "Blair", seatIndex: 1, isActive: true }
];

describe("ledger", () => {
  it("tracks chip buy-ins, player gifts, chip returns, and voids", () => {
    const transactions: Transaction[] = [
      {
        id: "t1",
        type: "bank_buy_in",
        createdAt: "2026-05-10T00:00:00.000Z",
        amountCents: 2000,
        toPlayerId: "alex"
      },
      {
        id: "t2",
        type: "player_gave",
        createdAt: "2026-05-10T00:01:00.000Z",
        amountCents: 1000,
        fromPlayerId: "blair",
        toPlayerId: "alex"
      },
      {
        id: "t3",
        type: "bank_cash_out",
        createdAt: "2026-05-10T00:02:00.000Z",
        amountCents: 3500,
        fromPlayerId: "alex"
      },
      {
        id: "voided",
        type: "bank_buy_in",
        createdAt: "2026-05-10T00:03:00.000Z",
        amountCents: 9999,
        toPlayerId: "alex",
        voidedAt: "2026-05-10T00:04:00.000Z"
      }
    ];

    const summaries = buildPlayerSummaries(players, transactions);
    const alex = summaries.find((summary) => summary.playerId === "alex");
    const blair = summaries.find((summary) => summary.playerId === "blair");
    const bank = calculateBankSummary(transactions);

    expect(alex?.bankBuyInsCents).toBe(2000);
    expect(alex?.receivedFromPlayersCents).toBe(1000);
    expect(alex?.bankCashOutsCents).toBe(3500);
    expect(alex?.netCents).toBe(500);
    expect(blair?.sentToPlayersCents).toBe(1000);
    expect(blair?.netCents).toBe(1000);
    expect(bank.incomingCents).toBe(2000);
    expect(bank.outgoingCents).toBe(3500);
    expect(bank.balanceCents).toBe(-1500);
    expect(calculateLedgerImbalanceCents(summaries, bank)).toBe(0);
  });

  it("reverses the player relationship for debts", () => {
    const summaries = buildPlayerSummaries(players, [
      {
        id: "food-debt",
        type: "player_owes",
        createdAt: "2026-05-10T00:00:00.000Z",
        amountCents: 750,
        fromPlayerId: "alex",
        toPlayerId: "blair",
        category: "food"
      }
    ]);
    const alex = summaries.find((summary) => summary.playerId === "alex")!;
    const blair = summaries.find((summary) => summary.playerId === "blair")!;

    expect(alex.owedToPlayersCents).toBe(750);
    expect(alex.owedByPlayersCents).toBe(0);
    expect(alex.netCents).toBe(-750);
    expect(blair.owedToPlayersCents).toBe(0);
    expect(blair.owedByPlayersCents).toBe(750);
    expect(blair.netCents).toBe(750);
    expect(calculateLedgerImbalanceCents(summaries, calculateBankSummary([]))).toBe(0);
  });

  it("keeps manual chip adjustments visible as imbalance", () => {
    const transactions: Transaction[] = [
      {
        id: "adjustment",
        type: "manual_bank_adjustment",
        createdAt: "2026-05-10T00:00:00.000Z",
        amountCents: 500,
        bankDirection: "incoming"
      }
    ];

    const summaries = buildPlayerSummaries(players, transactions);
    const bank = calculateBankSummary(transactions);

    expect(bank.incomingCents).toBe(500);
    expect(calculateLedgerImbalanceCents(summaries, bank)).toBe(500);
  });

  it("assigns covered buy-ins to the coverer and can move a full debt", () => {
    const transactions: Transaction[] = [
      {
        id: "covered-buy-in",
        type: "bank_buy_in",
        createdAt: "2026-05-10T00:00:00.000Z",
        amountCents: 2000,
        toPlayerId: "blair",
        coveredByPlayerId: "alex"
      },
      {
        id: "coverage",
        type: "debt_coverage",
        createdAt: "2026-05-10T00:01:00.000Z",
        amountCents: 2000,
        coveredPlayerId: "alex",
        coveredByPlayerId: "blair"
      }
    ];

    const summaries = buildPlayerSummaries(players, transactions);
    const alex = summaries.find((summary) => summary.playerId === "alex")!;
    const blair = summaries.find((summary) => summary.playerId === "blair")!;
    const bank = calculateBankSummary(transactions);

    expect(alex.bankBuyInsCents).toBe(2000);
    expect(alex.debtCoveredByOthersCents).toBe(2000);
    expect(alex.netCents).toBe(0);
    expect(blair.bankBuyInsCents).toBe(0);
    expect(blair.debtCoveredForOthersCents).toBe(2000);
    expect(blair.netCents).toBe(-2000);
    expect(bank.balanceCents).toBe(2000);
    expect(calculateLedgerImbalanceCents(summaries, bank)).toBe(0);
  });

  it("ignores voided coverage entries", () => {
    const transactions: Transaction[] = [
      {
        id: "coverage",
        type: "debt_coverage",
        createdAt: "2026-05-10T00:00:00.000Z",
        amountCents: 3500,
        coveredPlayerId: "alex",
        coveredByPlayerId: "blair",
        voidedAt: "2026-05-10T00:01:00.000Z"
      }
    ];

    const summaries = buildPlayerSummaries(players, transactions);
    expect(summaries.every((summary) => summary.netCents === 0)).toBe(true);
  });
});
