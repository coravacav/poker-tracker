import { describe, expect, it } from "vitest";
import {
  chipCountTotalCents,
  currentFinalCashOutForPlayer,
  getCashOutOverview,
  isPlayerCashOutComplete,
  mergeChipCountLines
} from "../domain/chipCounts";
import type { BankSummary, CashOutDraft, ChipDenomination, Player, Transaction } from "../domain/pokerTypes";

const denominations: ChipDenomination[] = [
  { id: "blue", label: "Blue", colorHex: "#0000ff", valueCents: 500 },
  { id: "red", label: "Red", colorHex: "#ff0000", valueCents: 100 }
];

describe("chip counts", () => {
  it("merges current settings with draft counts and preserves removed lines", () => {
    const lines = mergeChipCountLines(denominations, [
      { denominationId: "blue", label: "Old blue", colorHex: "#1111ff", valueCents: 250, count: 4 },
      { denominationId: "legacy", label: "Purple", colorHex: "#800080", valueCents: 25, count: 8 }
    ]);

    expect(lines).toEqual([
      { denominationId: "blue", label: "Blue", colorHex: "#0000ff", valueCents: 500, count: 4 },
      { denominationId: "red", label: "Red", colorHex: "#ff0000", valueCents: 100, count: 0 },
      { denominationId: "legacy", label: "Purple", colorHex: "#800080", valueCents: 25, count: 8 }
    ]);
    expect(chipCountTotalCents(lines)).toBe(2200);
  });

  it("builds completion, projection, manual warnings, and aggregate totals", () => {
    const players: Player[] = [
      { id: "p1", name: "Alex", seatIndex: 0, isActive: true },
      { id: "p2", name: "Blair", seatIndex: 1, isActive: true }
    ];
    const transactions: Transaction[] = [
      { id: "buy", type: "bank_buy_in", createdAt: "2026-01-01", amountCents: 4000, toPlayerId: "p1" },
      { id: "out", type: "bank_cash_out", cashOutKind: "final", createdAt: "2026-01-02", amountCents: 2000, fromPlayerId: "p1" }
    ];
    const drafts: CashOutDraft[] = [
      {
        playerId: "p2",
        lines: [{ denominationId: "blue", label: "Blue", colorHex: "#0000ff", valueCents: 500, count: 3 }]
      }
    ];
    const bank: BankSummary = { incomingCents: 4000, outgoingCents: 2000, balanceCents: 2000 };
    const overview = getCashOutOverview(players, transactions, drafts, denominations, bank);

    expect([...overview.completedPlayerIds]).toEqual(["p1"]);
    expect(overview.missingPlayers.map((player) => player.id)).toEqual(["p2"]);
    expect(overview.cashOutsCompleteForSettlement).toBe(false);
    expect([...overview.manualFinalPlayerIds]).toEqual(["p1"]);
    expect(overview.projectedTotalCents).toBe(3500);
    expect(overview.projectedRemainingCents).toBe(500);
    expect(overview.aggregates[0]).toEqual(expect.objectContaining({ id: "blue", count: 3, totalCents: 1500 }));
  });

  it("projects a final draft on top of partial payouts without completing the player", () => {
    const players: Player[] = [
      { id: "p1", name: "Alex", seatIndex: 0, isActive: true }
    ];
    const transactions: Transaction[] = [
      { id: "buy", type: "bank_buy_in", createdAt: "2026-01-01", amountCents: 4000, toPlayerId: "p1" },
      { id: "partial", type: "bank_cash_out", cashOutKind: "partial", createdAt: "2026-01-02", amountCents: 1000, fromPlayerId: "p1" }
    ];
    const drafts: CashOutDraft[] = [
      {
        playerId: "p1",
        lines: [{ denominationId: "blue", label: "Blue", colorHex: "#0000ff", valueCents: 500, count: 6 }]
      }
    ];

    const overview = getCashOutOverview(
      players,
      transactions,
      drafts,
      denominations,
      { incomingCents: 4000, outgoingCents: 1000, balanceCents: 3000 }
    );

    expect(overview.completedPlayerIds.size).toBe(0);
    expect(overview.recordedTotalCents).toBe(1000);
    expect(overview.projectedTotalCents).toBe(4000);
    expect(overview.projectedRemainingCents).toBe(0);
    expect(overview.manualFinalPlayerIds.size).toBe(0);
  });

  it("accepts recorded partial cash-outs when the chip pool is empty", () => {
    const players: Player[] = [
      { id: "p1", name: "Alex", seatIndex: 0, isActive: true },
      { id: "p2", name: "Blair", seatIndex: 1, isActive: true }
    ];
    const transactions: Transaction[] = [
      { id: "buy-1", type: "bank_buy_in", createdAt: "2026-01-01", amountCents: 4000, toPlayerId: "p1" },
      { id: "buy-2", type: "bank_buy_in", createdAt: "2026-01-01", amountCents: 4000, toPlayerId: "p2" },
      { id: "partial-1", type: "bank_cash_out", cashOutKind: "partial", createdAt: "2026-01-02", amountCents: 4000, fromPlayerId: "p1" },
      { id: "partial-2", type: "bank_cash_out", cashOutKind: "partial", createdAt: "2026-01-02", amountCents: 4000, fromPlayerId: "p2" }
    ];

    const overview = getCashOutOverview(
      players,
      transactions,
      [],
      denominations,
      { incomingCents: 8000, outgoingCents: 8000, balanceCents: 0 }
    );

    expect(overview.completedPlayerIds.size).toBe(0);
    expect(overview.missingPlayers.map((player) => player.id)).toEqual(["p1", "p2"]);
    expect(overview.cashOutsCompleteForSettlement).toBe(true);
  });

  it("reopens completion after later chip activity and ignores non-chip activity", () => {
    const transactions: Transaction[] = [
      { id: "buy", type: "bank_buy_in", createdAt: "2026-01-01T00:00:00Z", amountCents: 2000, toPlayerId: "p1" },
      { id: "partial", type: "bank_cash_out", cashOutKind: "partial", createdAt: "2026-01-01T01:00:00Z", amountCents: 500, fromPlayerId: "p1" },
      { id: "final-1", type: "bank_cash_out", cashOutKind: "final", createdAt: "2026-01-01T02:00:00Z", amountCents: 1500, fromPlayerId: "p1" },
      { id: "food", type: "player_transfer", category: "food", createdAt: "2026-01-01T03:00:00Z", amountCents: 300, fromPlayerId: "p1", toPlayerId: "p2" },
      { id: "coverage", type: "debt_coverage", createdAt: "2026-01-01T04:00:00Z", amountCents: 300, coveredPlayerId: "p1", coveredByPlayerId: "p2" }
    ];

    expect(isPlayerCashOutComplete(transactions, "p1")).toBe(true);
    expect(currentFinalCashOutForPlayer(transactions, "p1")?.id).toBe("final-1");

    transactions.push({
      id: "rebuy",
      type: "bank_buy_in",
      createdAt: "2026-01-01T05:00:00Z",
      amountCents: 1000,
      toPlayerId: "p1"
    });
    expect(isPlayerCashOutComplete(transactions, "p1")).toBe(false);

    transactions.push({
      id: "final-2",
      type: "bank_cash_out",
      cashOutKind: "final",
      createdAt: "2026-01-01T06:00:00Z",
      amountCents: 1000,
      fromPlayerId: "p1"
    });
    expect(currentFinalCashOutForPlayer(transactions, "p1")?.id).toBe("final-2");

    transactions.push({
      id: "poker-transfer",
      type: "player_transfer",
      category: "poker",
      createdAt: "2026-01-01T07:00:00Z",
      amountCents: 100,
      fromPlayerId: "p2",
      toPlayerId: "p1"
    });
    expect(isPlayerCashOutComplete(transactions, "p1")).toBe(false);
  });
});
