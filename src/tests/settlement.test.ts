import { describe, expect, it } from "vitest";
import type { PlayerLedgerSummary } from "../domain/pokerTypes";
import {
  buildBankSettlement,
  buildMinimizedSettlement,
  filterSettlementSummariesForDisplay
} from "../domain/settlement";

function summary(playerId: string, netCents: number): PlayerLedgerSummary {
  return {
    playerId,
    bankBuyInsCents: 0,
    bankCashOutsCents: 0,
    sentToPlayersCents: 0,
    receivedFromPlayersCents: 0,
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

  it("builds bank settlement directions", () => {
    expect(buildBankSettlement([summary("a", -500), summary("b", 700), summary("c", 0)])).toEqual([
      {
        playerId: "a",
        direction: "player_pays_bank",
        amountCents: 500
      },
      {
        playerId: "b",
        direction: "bank_pays_player",
        amountCents: 700
      },
      {
        playerId: "c",
        direction: "settled",
        amountCents: 0
      }
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
});
