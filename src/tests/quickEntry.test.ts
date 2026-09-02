import { describe, expect, it } from "vitest";
import { latestRepeatableTransaction, repeatTransaction } from "../domain/quickEntry";
import type { Transaction } from "../domain/pokerTypes";

describe("quick transaction entry", () => {
  it("finds the latest safe transaction to repeat", () => {
    const transactions: Transaction[] = [
      { id: "buy", type: "bank_buy_in", amountCents: 2000, toPlayerId: "a", createdAt: "2026-01-01" },
      { id: "final", type: "bank_cash_out", cashOutKind: "final", amountCents: 2000, fromPlayerId: "a", createdAt: "2026-01-02" }
    ];
    expect(latestRepeatableTransaction(transactions)?.id).toBe("buy");
  });

  it("repeats without correction metadata", () => {
    const original: Transaction = {
      id: "old",
      type: "player_gave",
      amountCents: 500,
      fromPlayerId: "a",
      toPlayerId: "b",
      createdAt: "old",
      note: "Snacks",
      voidedAt: "later"
    };
    expect(repeatTransaction(original, "new", "now")).toMatchObject({
      id: "new",
      createdAt: "now",
      note: "Repeat: Snacks",
      voidedAt: undefined
    });
  });
});
