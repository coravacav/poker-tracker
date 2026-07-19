import { describe, expect, it } from "vitest";
import type { Transaction } from "../domain/pokerTypes";
import {
  getLatestTransactionAction,
  isRecentTransactionAction
} from "../domain/recentTransactionAction";

function buyIn(changes: Partial<Transaction>): Transaction {
  return {
    id: "transaction",
    type: "bank_buy_in",
    createdAt: "2026-05-10T00:00:00.000Z",
    amountCents: 2000,
    toPlayerId: "player",
    ...changes
  };
}

describe("recent transaction actions", () => {
  it("selects a newer void performed on an older transaction", () => {
    const transactions = [
      buyIn({
        id: "older",
        voidedAt: "2026-05-10T00:00:20.000Z",
        voidReason: "Correction"
      }),
      buyIn({ id: "newer", createdAt: "2026-05-10T00:00:10.000Z" })
    ];

    expect(getLatestTransactionAction(transactions)).toEqual({
      kind: "void",
      transactionId: "older",
      occurredAt: "2026-05-10T00:00:20.000Z"
    });
  });

  it("folds an automatic flip void into the generated transaction creation", () => {
    const transactions = [
      buyIn({
        id: "original",
        voidedAt: "2026-05-10T00:00:20.100Z",
        voidReason: "Flipped transaction"
      }),
      buyIn({
        id: "flipped",
        createdAt: "2026-05-10T00:00:20.000Z",
        flippedFromTransactionId: "original"
      })
    ];

    expect(getLatestTransactionAction(transactions)).toEqual({
      kind: "create",
      transactionId: "flipped",
      occurredAt: "2026-05-10T00:00:20.100Z"
    });
  });

  it("prefers a later manual void of a generated transaction", () => {
    const transactions = [
      buyIn({
        id: "original",
        voidedAt: "2026-05-10T00:00:20.100Z",
        voidReason: "Flipped transaction"
      }),
      buyIn({
        id: "flipped",
        createdAt: "2026-05-10T00:00:20.000Z",
        flippedFromTransactionId: "original",
        voidedAt: "2026-05-10T00:00:25.000Z",
        voidReason: "Correction"
      })
    ];

    expect(getLatestTransactionAction(transactions)).toEqual({
      kind: "void",
      transactionId: "flipped",
      occurredAt: "2026-05-10T00:00:25.000Z"
    });
  });

  it("uses the later transaction and then its void for timestamp ties", () => {
    const occurredAt = "2026-05-10T00:00:20.000Z";
    const transactions = [
      buyIn({ id: "first", createdAt: occurredAt }),
      buyIn({
        id: "second",
        createdAt: occurredAt,
        voidedAt: occurredAt,
        voidReason: "Correction"
      })
    ];

    expect(getLatestTransactionAction(transactions)).toEqual({
      kind: "void",
      transactionId: "second",
      occurredAt
    });
  });

  it("returns no action for malformed timestamps or broken links", () => {
    expect(getLatestTransactionAction([buyIn({ createdAt: "not-a-date" })])).toBeNull();
    expect(
      getLatestTransactionAction([
        buyIn({
          id: "broken",
          flippedFromTransactionId: "missing"
        })
      ])
    ).toBeNull();
  });

  it("enforces the strict 30-second window and rejects future actions", () => {
    const action = {
      kind: "create" as const,
      transactionId: "transaction",
      occurredAt: "2026-05-10T00:00:00.000Z"
    };
    const occurredAtMs = Date.parse(action.occurredAt);

    expect(isRecentTransactionAction(action, occurredAtMs + 29_999)).toBe(true);
    expect(isRecentTransactionAction(action, occurredAtMs + 30_000)).toBe(false);
    expect(isRecentTransactionAction(action, occurredAtMs - 1)).toBe(false);
  });
});
