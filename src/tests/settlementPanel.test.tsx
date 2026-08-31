import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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
    owedToPlayersCents: 0,
    owedByPlayersCents: 0,
    debtCoveredByOthersCents: 0,
    debtCoveredForOthersCents: 0,
    netCents: -3000
  },
  {
    playerId: "blair",
    bankBuyInsCents: 0,
    bankCashOutsCents: 0,
    sentToPlayersCents: 0,
    receivedFromPlayersCents: 0,
    owedToPlayersCents: 0,
    owedByPlayersCents: 0,
    debtCoveredByOthersCents: 0,
    debtCoveredForOthersCents: 0,
    netCents: 1000
  },
  {
    playerId: "casey",
    bankBuyInsCents: 0,
    bankCashOutsCents: 0,
    sentToPlayersCents: 0,
    receivedFromPlayersCents: 0,
    owedToPlayersCents: 0,
    owedByPlayersCents: 0,
    debtCoveredByOthersCents: 0,
    debtCoveredForOthersCents: 0,
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
        onAddTransaction={vi.fn(() => true)}
        players={players}
        readOnly={false}
        settlementReady={true}
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

  it("records one player's exact full debt against a selected coverer", () => {
    const onAddTransaction = vi.fn(() => true);
    render(
      <SettlementPanel
        bankSummary={{ incomingCents: 3000, outgoingCents: 3000, balanceCents: 0 }}
        imbalanceCents={0}
        onAddTransaction={onAddTransaction}
        players={players}
        readOnly={false}
        settlementReady={true}
        summaries={summaries}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Cover debt" }));
    expect(screen.getByRole("dialog", { name: "Cover full debt" })).toHaveTextContent(
      "Cover Alex's full debt"
    );
    fireEvent.change(screen.getByLabelText("Covered by"), {
      target: { value: "blair" }
    });
    expect(screen.getByLabelText("Debt coverage preview")).toHaveTextContent(
      "AlexCovered player-$30.00 → $0.00"
    );
    expect(screen.getByLabelText("Debt coverage preview")).toHaveTextContent(
      "BlairCoverer$10.00 → -$20.00"
    );

    fireEvent.click(screen.getByRole("button", { name: "Record debt coverage" }));
    expect(onAddTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "debt_coverage",
        amountCents: 3000,
        coveredPlayerId: "alex",
        coveredByPlayerId: "blair"
      })
    );
  });

  it("disables debt coverage until settlement is ready", () => {
    render(
      <SettlementPanel
        bankSummary={bankSummary}
        imbalanceCents={0}
        onAddTransaction={vi.fn(() => true)}
        players={players}
        readOnly={false}
        settlementReady={false}
        summaries={summaries}
      />
    );

    expect(screen.getByRole("button", { name: "Cover debt" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cover debt" })).toHaveAttribute(
      "title",
      expect.stringContaining("Complete all cash-outs")
    );
  });
});
