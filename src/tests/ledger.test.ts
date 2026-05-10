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
  it("tracks bank buy-ins, cash-outs, player transfers, and voids", () => {
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
        type: "player_transfer",
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

  it("keeps manual bank adjustments visible as imbalance", () => {
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
});
