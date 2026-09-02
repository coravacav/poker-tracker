import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TransactionForm } from "../components/TransactionForm";
import type { Player } from "../domain/pokerTypes";

const players: Player[] = [
  { id: "p1", name: "Alex", seatIndex: 0, isActive: true },
  { id: "p2", name: "Blair", seatIndex: 1, isActive: true }
];

describe("TransactionForm", () => {
  it("keeps the selected player and amount when switching between buy-in and cash-out", () => {
    const onAddTransaction = vi.fn(() => true);

    render(
      <TransactionForm
        defaultBuyInCents={2000}
        onAddTransaction={onAddTransaction}
        players={players}
        readOnly={false}
      />
    );

    fireEvent.change(screen.getByLabelText("To"), { target: { value: "p2" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "37.50" } });
    fireEvent.change(screen.getByLabelText("Type"), {
      target: { value: "bank_cash_out" }
    });

    expect(screen.getByLabelText("From")).toHaveValue("p2");
    expect(screen.getByLabelText("Amount")).toHaveValue("37.50");

    fireEvent.change(screen.getByLabelText("Type"), {
      target: { value: "bank_buy_in" }
    });
    expect(screen.getByLabelText("To")).toHaveValue("p2");

    fireEvent.change(screen.getByLabelText("Type"), {
      target: { value: "bank_cash_out" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Add transaction" }));

    expect(onAddTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "bank_cash_out",
        cashOutKind: "partial",
        fromPlayerId: "p2",
        amountCents: 3750
      })
    );
    expect(screen.getByText(/during-game payout/)).toBeInTheDocument();
  });

  it("keeps transfer participants independent from the bank player", () => {
    render(
      <TransactionForm
        defaultBuyInCents={2000}
        onAddTransaction={vi.fn(() => true)}
        players={players}
        readOnly={false}
      />
    );

    fireEvent.change(screen.getByLabelText("Type"), {
      target: { value: "player_gave" }
    });
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "p2" } });

    fireEvent.change(screen.getByLabelText("Type"), {
      target: { value: "bank_buy_in" }
    });
    fireEvent.change(screen.getByLabelText("Type"), {
      target: { value: "bank_cash_out" }
    });
    expect(screen.getByLabelText("From")).toHaveValue("p1");

    fireEvent.change(screen.getByLabelText("Type"), {
      target: { value: "player_gave" }
    });
    expect(screen.getByLabelText("From")).toHaveValue("p2");
    expect(screen.getByLabelText("To")).toHaveValue("p1");
  });

  it("offers transfer amounts based on the default buy-in", () => {
    render(
      <TransactionForm
        defaultBuyInCents={2000}
        onAddTransaction={vi.fn(() => true)}
        players={players}
        readOnly={false}
      />
    );

    fireEvent.change(screen.getByLabelText("Type"), {
      target: { value: "player_gave" }
    });

    expect(screen.getByRole("button", { name: "2 buy-ins $40.00" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1 buy-in $20.00" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1/2 buy-in $10.00" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1/4 buy-in $5.00" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "1/4 buy-in $5.00" }));
    expect(screen.getByLabelText("Amount")).toHaveValue("5.00");
  });

  it("records a player owes entry with debtor and creditor directions", () => {
    const onAddTransaction = vi.fn(() => true);

    render(
      <TransactionForm
        defaultBuyInCents={2000}
        onAddTransaction={onAddTransaction}
        players={players}
        readOnly={false}
      />
    );

    fireEvent.change(screen.getByLabelText("Type"), {
      target: { value: "player_owes" }
    });
    expect(screen.getByLabelText("Owes")).toHaveValue("p1");
    expect(screen.getByLabelText("Owed to")).toHaveValue("p1");
    fireEvent.change(screen.getByLabelText("Owed to"), { target: { value: "p2" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "12.50" } });

    expect(screen.getByLabelText("Player owes preview")).toHaveTextContent(
      "AlexOwes$0.00-$12.50=-$12.50"
    );
    expect(screen.getByLabelText("Player owes preview")).toHaveTextContent(
      "BlairOwed to$0.00+$12.50=$12.50"
    );

    fireEvent.click(screen.getByRole("button", { name: "Add transaction" }));

    expect(onAddTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "player_owes",
        fromPlayerId: "p1",
        toPlayerId: "p2",
        category: "food",
        amountCents: 1250
      })
    );
  });

  it("records a covered buy-in and retires food creation", () => {
    const onAddTransaction = vi.fn(() => true);

    render(
      <TransactionForm
        defaultBuyInCents={2000}
        onAddTransaction={onAddTransaction}
        players={players}
        readOnly={false}
        summaryByPlayerId={
          new Map([
            [
              "p1",
              {
                playerId: "p1",
                bankBuyInsCents: 0,
                bankCashOutsCents: 0,
                sentToPlayersCents: 0,
                receivedFromPlayersCents: 0,
                owedToPlayersCents: 0,
                owedByPlayersCents: 0,
                debtCoveredByOthersCents: 0,
                debtCoveredForOthersCents: 0,
                netCents: -2000
              }
            ],
            [
              "p2",
              {
                playerId: "p2",
                bankBuyInsCents: 0,
                bankCashOutsCents: 0,
                sentToPlayersCents: 0,
                receivedFromPlayersCents: 0,
                owedToPlayersCents: 0,
                owedByPlayersCents: 0,
                debtCoveredByOthersCents: 0,
                debtCoveredForOthersCents: 0,
                netCents: 1000
              }
            ]
          ])
        }
      />
    );

    expect(screen.queryByText(/Food/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Type"), {
      target: { value: "covered_buy_in" }
    });
    fireEvent.change(screen.getByLabelText("Chips to"), { target: { value: "p2" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "15" } });

    expect(screen.getByLabelText("Covered buy-in preview")).toHaveTextContent(
      "AlexCoverer-$20.00-$15.00=-$35.00"
    );
    expect(screen.getByText(/Blair receives \$15.00 in chips/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add transaction" }));

    expect(onAddTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "bank_buy_in",
        toPlayerId: "p2",
        coveredByPlayerId: "p1",
        amountCents: 1500,
        note: undefined
      })
    );
  });

  it("builds a final cash-out request from guest chip counts", () => {
    const onAddTransaction = vi.fn(() => true);
    render(
      <TransactionForm
        allowFinalCashOut
        chipDenominations={[
          { id: "red", label: "Red", colorHex: "#ff0000", valueCents: 500 },
          { id: "blue", label: "Blue", colorHex: "#0000ff", valueCents: 100 }
        ]}
        defaultBuyInCents={2000}
        onAddTransaction={onAddTransaction}
        players={players}
        readOnly={false}
      />
    );
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "final_chip_count" } });
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "p2" } });
    fireEvent.change(screen.getByLabelText("Red chip count"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Blue chip count"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Add transaction" }));

    expect(onAddTransaction).toHaveBeenCalledWith(expect.objectContaining({
      type: "bank_cash_out",
      cashOutKind: "final",
      fromPlayerId: "p2",
      amountCents: 1700,
      chipCountBreakdown: [
        expect.objectContaining({ denominationId: "red", count: 3 }),
        expect.objectContaining({ denominationId: "blue", count: 2 })
      ]
    }));
  });
});
