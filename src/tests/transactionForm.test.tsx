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
        fromPlayerId: "p2",
        amountCents: 3750
      })
    );
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
      target: { value: "player_transfer" }
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
      target: { value: "player_transfer" }
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
      target: { value: "player_transfer" }
    });

    expect(screen.getByRole("button", { name: "2 buy-ins $40.00" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1 buy-in $20.00" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1/2 buy-in $10.00" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1/4 buy-in $5.00" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "1/4 buy-in $5.00" }));
    expect(screen.getByLabelText("Amount")).toHaveValue("5.00");
  });

  it("records food as a fast player transfer category", () => {
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
                netCents: 1000
              }
            ]
          ])
        }
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Food transfer" }));
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "p2" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "15" } });

    expect(screen.getByLabelText("Transfer preview")).toHaveTextContent(
      "AlexSender-$20.00+$15.00=-$5.00"
    );
    expect(screen.getByLabelText("Transfer preview")).toHaveTextContent(
      "BlairReceiver$10.00-$15.00=-$5.00"
    );

    fireEvent.click(screen.getByRole("button", { name: "Add transaction" }));

    expect(onAddTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "player_transfer",
        fromPlayerId: "p1",
        toPlayerId: "p2",
        amountCents: 1500,
        category: "food",
        note: undefined
      })
    );
  });
});
