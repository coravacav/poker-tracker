import { describe, expect, it } from "vitest";
import { validateTransaction } from "../domain/validation";
import type { Player, Transaction } from "../domain/pokerTypes";

const players: Player[] = [{ id: "p1", name: "Alex", seatIndex: 0, isActive: true }];

function transaction(changes: Partial<Transaction> = {}): Transaction {
  return {
    id: "cashout",
    type: "bank_cash_out",
    createdAt: "2026-01-01",
    amountCents: 1000,
    fromPlayerId: "p1",
    chipCountBreakdown: [
      { denominationId: "blue", label: "Blue", colorHex: "#0000ff", valueCents: 500, count: 2 }
    ],
    ...changes
  };
}

describe("chip count validation", () => {
  it("accepts matching breakdowns and explicit zero counts", () => {
    expect(validateTransaction(transaction(), players)).toBeNull();
    expect(validateTransaction(transaction({ amountCents: 0, chipCountBreakdown: [] }), players)).toBeNull();
  });

  it("rejects mismatched, duplicate, and non-cash-out breakdowns", () => {
    expect(validateTransaction(transaction({ amountCents: 999 }), players)).toMatch(/does not match/);
    const line = transaction().chipCountBreakdown![0];
    expect(validateTransaction(transaction({ chipCountBreakdown: [line, line], amountCents: 2000 }), players)).toMatch(/valid chip count/);
    expect(
      validateTransaction(
        transaction({ type: "bank_buy_in", fromPlayerId: undefined, toPlayerId: "p1" }),
        players
      )
    ).toMatch(/only valid for cash-outs/);
  });
});
