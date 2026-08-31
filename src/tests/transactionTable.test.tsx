import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TransactionTable } from "../components/TransactionTable";

describe("TransactionTable chip breakdown", () => {
  it("shows an expandable saved breakdown and correction metadata", () => {
    render(
      <TransactionTable
        dispatch={vi.fn()}
        players={[{ id: "p1", name: "Alex", seatIndex: 0, isActive: true }]}
        readOnly={false}
        transactions={[
          {
            id: "cashout",
            type: "bank_cash_out",
            createdAt: "2026-01-01",
            amountCents: 1000,
            fromPlayerId: "p1",
            correctsTransactionId: "old",
            chipCountBreakdown: [
              { denominationId: "blue", label: "Blue", colorHex: "#0000ff", valueCents: 500, count: 2 }
            ]
          }
        ]}
        variant="compact"
      />
    );

    expect(screen.getByText("Corrects transaction old")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Chip breakdown"));
    expect(screen.getByText("2 × $5.00")).toBeInTheDocument();
  });

  it("labels covered buy-ins and debt coverage while disabling debt flips", () => {
    render(
      <TransactionTable
        dispatch={vi.fn()}
        players={[
          { id: "alex", name: "Alex", seatIndex: 0, isActive: true },
          { id: "blair", name: "Blair", seatIndex: 1, isActive: true }
        ]}
        readOnly={false}
        transactions={[
          {
            id: "buy-in",
            type: "bank_buy_in",
            createdAt: "2026-01-01",
            amountCents: 2000,
            toPlayerId: "blair",
            coveredByPlayerId: "alex"
          },
          {
            id: "coverage",
            type: "debt_coverage",
            createdAt: "2026-01-02",
            amountCents: 1500,
            coveredPlayerId: "blair",
            coveredByPlayerId: "alex"
          }
        ]}
        variant="compact"
      />
    );

    expect(screen.getByRole("heading", { name: "Covered buy-in" })).toBeInTheDocument();
    expect(screen.getByText("Covered by Alex")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Debt coverage" })).toBeInTheDocument();
    expect(screen.getByText("Alex covers Blair")).toBeInTheDocument();
    const flipButtons = screen.getAllByTitle("Flip transaction");
    expect(flipButtons[0]).toBeDisabled();
    expect(flipButtons[1]).not.toBeDisabled();
  });

  it("labels player gifts and debts with their explicit direction", () => {
    render(
      <TransactionTable
        dispatch={vi.fn()}
        players={[
          { id: "alex", name: "Alex", seatIndex: 0, isActive: true },
          { id: "blair", name: "Blair", seatIndex: 1, isActive: true }
        ]}
        readOnly={false}
        transactions={[
          {
            id: "gift",
            type: "player_gave",
            createdAt: "2026-01-01T00:00:00Z",
            amountCents: 500,
            fromPlayerId: "alex",
            toPlayerId: "blair",
            category: "poker"
          },
          {
            id: "debt",
            type: "player_owes",
            createdAt: "2026-01-01T01:00:00Z",
            amountCents: 300,
            fromPlayerId: "alex",
            toPlayerId: "blair",
            category: "food"
          }
        ]}
        variant="compact"
      />
    );

    expect(screen.getByRole("heading", { name: "Player gave" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Player owes" })).toBeInTheDocument();
    expect(screen.getByText("owes")).toBeInTheDocument();
    expect(screen.getByText("Food")).toBeInTheDocument();
    expect(screen.getByText("Poker")).toBeInTheDocument();
  });
});
