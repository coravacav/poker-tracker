import { describe, expect, it } from "vitest";
import {
  chipCountTotalCents,
  getCashOutOverview,
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
      { id: "out", type: "bank_cash_out", createdAt: "2026-01-02", amountCents: 2000, fromPlayerId: "p1" }
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
    expect([...overview.manualPlayerIds]).toEqual(["p1"]);
    expect(overview.projectedTotalCents).toBe(3500);
    expect(overview.projectedRemainingCents).toBe(500);
    expect(overview.aggregates[0]).toEqual(expect.objectContaining({ id: "blue", count: 3, totalCents: 1500 }));
  });
});
