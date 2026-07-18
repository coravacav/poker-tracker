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
});
