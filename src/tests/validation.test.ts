import { describe, expect, it } from "vitest";
import { validateTransaction } from "../domain/validation";
import type { Player, Transaction } from "../domain/pokerTypes";

const players: Player[] = [{ id: "p1", name: "Alex", seatIndex: 0, isActive: true }];

function transaction(changes: Partial<Transaction> = {}): Transaction {
  return {
    id: "cashout",
    type: "bank_cash_out",
    cashOutKind: "final",
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

  it("requires positive partial cash-outs and keeps cash-out kinds type-specific", () => {
    expect(
      validateTransaction(
        transaction({ cashOutKind: "partial", amountCents: 0, chipCountBreakdown: [] }),
        players
      )
    ).toMatch(/greater than zero/);
    expect(
      validateTransaction(
        transaction({
          type: "bank_buy_in",
          cashOutKind: "partial",
          fromPlayerId: undefined,
          toPlayerId: "p1",
          chipCountBreakdown: undefined
        }),
        players
      )
    ).toMatch(/only valid for cash-outs/);
  });
});

describe("coverage validation", () => {
  const players = [
    { id: "alex", name: "Alex", seatIndex: 0, isActive: true },
    { id: "blair", name: "Blair", seatIndex: 1, isActive: true }
  ];

  it("accepts covered buy-ins and full debt coverage", () => {
    expect(
      validateTransaction(
        {
          id: "buy-in",
          type: "bank_buy_in",
          createdAt: "2026-01-01",
          amountCents: 2000,
          toPlayerId: "blair",
          coveredByPlayerId: "alex"
        },
        players
      )
    ).toBeNull();
    expect(
      validateTransaction(
        {
          id: "coverage",
          type: "debt_coverage",
          createdAt: "2026-01-01",
          amountCents: 2000,
          coveredPlayerId: "blair",
          coveredByPlayerId: "alex"
        },
        players
      )
    ).toBeNull();
  });

  it("rejects self-coverage, missing players, and misplaced coverage fields", () => {
    expect(
      validateTransaction(
        {
          id: "self",
          type: "bank_buy_in",
          createdAt: "2026-01-01",
          amountCents: 2000,
          toPlayerId: "alex",
          coveredByPlayerId: "alex"
        },
        players
      )
    ).toMatch(/different player/);
    expect(
      validateTransaction(
        {
          id: "missing",
          type: "debt_coverage",
          createdAt: "2026-01-01",
          amountCents: 2000,
          coveredPlayerId: "missing",
          coveredByPlayerId: "alex"
        },
        players
      )
    ).toMatch(/must exist/);
    expect(
      validateTransaction(
        {
          id: "wrong-type",
          type: "player_transfer",
          createdAt: "2026-01-01",
          amountCents: 2000,
          fromPlayerId: "alex",
          toPlayerId: "blair",
          coveredByPlayerId: "alex"
        },
        players
      )
    ).toMatch(/only valid/);
  });
});
