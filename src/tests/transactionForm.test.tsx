import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TransactionForm } from "../components/TransactionForm";
import type { Player } from "../domain/pokerTypes";

const players: Player[] = [
  { id: "p1", name: "Alex", seatIndex: 0, isActive: true },
  { id: "p2", name: "Blair", seatIndex: 1, isActive: true }
];

describe("TransactionForm", () => {
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
