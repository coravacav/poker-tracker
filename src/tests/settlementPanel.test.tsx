import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SettlementPanel } from "../components/SettlementPanel";
import type { BankSummary, Player, PlayerLedgerSummary } from "../domain/pokerTypes";

const players: Player[] = [
  { id: "alex", name: "Alex", seatIndex: 0, isActive: true },
  { id: "blair", name: "Blair", seatIndex: 1, isActive: true },
  { id: "casey", name: "Casey", seatIndex: 2, isActive: true }
];

const summaries: PlayerLedgerSummary[] = [
  {
    playerId: "alex",
    bankBuyInsCents: 0,
    bankCashOutsCents: 0,
    sentToPlayersCents: 0,
    receivedFromPlayersCents: 0,
    netCents: -3000
  },
  {
    playerId: "blair",
    bankBuyInsCents: 0,
    bankCashOutsCents: 0,
    sentToPlayersCents: 0,
    receivedFromPlayersCents: 0,
    netCents: 1000
  },
  {
    playerId: "casey",
    bankBuyInsCents: 0,
    bankCashOutsCents: 0,
    sentToPlayersCents: 0,
    receivedFromPlayersCents: 0,
    netCents: 2000
  }
];

const bankSummary: BankSummary = {
  incomingCents: 3000,
  outgoingCents: 0,
  balanceCents: 3000
};

describe("SettlementPanel", () => {
  it("tracks and clears checked settlement payments", () => {
    render(
      <SettlementPanel
        bankSummary={bankSummary}
        imbalanceCents={0}
        players={players}
        summaries={summaries}
      />
    );

    expect(screen.getByText("0 of 2 payments settled")).toBeInTheDocument();

    const paymentCheckbox = screen.getByRole("checkbox", {
      name: "Mark Alex to Casey $20.00 as paid"
    });
    fireEvent.click(paymentCheckbox);

    expect(paymentCheckbox).toBeChecked();
    expect(screen.getByText("1 of 2 payments settled")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear checks" }));

    expect(paymentCheckbox).not.toBeChecked();
    expect(screen.getByText("0 of 2 payments settled")).toBeInTheDocument();
  });
});
