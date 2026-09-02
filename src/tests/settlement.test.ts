import { describe, expect, it } from "vitest";
import type { PlayerLedgerSummary } from "../domain/pokerTypes";
import {
  buildMinimizedSettlement,
  buildSettlementSummaryText,
  filterSettlementSummariesForDisplay
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
