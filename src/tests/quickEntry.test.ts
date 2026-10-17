import { describe, expect, it } from "vitest";
import { buyInToAllConfirmation, latestRepeatableTransaction, repeatTransaction } from "../domain/quickEntry";
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

  describe("asking before a buy-in for everyone", () => {
    const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
    const buyIn = (id: string, playerId: string, voidedAt?: string): Transaction => ({
      id,
      type: "bank_buy_in",
      amountCents: 2000,
      toPlayerId: playerId,
      createdAt: "2026-01-01",
      ...(voidedAt ? { voidedAt } : {})
    });

    it("lets the opening round through without asking", () => {
      expect(buyInToAllConfirmation(["a", "b"], [], 2000, dollars)).toBeNull();
      // A voided buy-in does not count, nor does money between players.
      expect(buyInToAllConfirmation(["a", "b"], [
        buyIn("void", "a", "2026-01-02"),
        { id: "gave", type: "player_gave", amountCents: 500, fromPlayerId: "a", toPlayerId: "b", createdAt: "2026-01-01" }
      ], 2000, dollars)).toBeNull();
    });

    it("asks once everyone has bought in, naming the total", () => {
      expect(buyInToAllConfirmation(["a", "b", "c"], [buyIn("1", "a"), buyIn("2", "b"), buyIn("3", "c")], 2000, dollars))
        .toBe("Everyone has already bought in. Add a $20.00 buy-in for all 3 ($60.00 in all)? Undo takes back only the last one.");
    });

    it("counts who is in when only some have bought in", () => {
      expect(buyInToAllConfirmation(["a", "b", "c"], [buyIn("1", "b")], 2500, dollars))
        .toBe("1 of 3 players have already bought in. Add a $25.00 buy-in for all 3 ($75.00 in all)? Undo takes back only the last one.");
    });

    it("skips the total for a single player", () => {
      expect(buyInToAllConfirmation(["a"], [buyIn("1", "a")], 2000, dollars))
        .toBe("Everyone has already bought in. Add a $20.00 buy-in? Undo takes back only the last one.");
    });
  });
});
