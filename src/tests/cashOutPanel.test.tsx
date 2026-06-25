import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CashOutPanel } from "../components/CashOutPanel";
import type { Player, PlayerLedgerSummary } from "../domain/pokerTypes";

const players: Player[] = [
  { id: "p1", name: "Player 1", seatIndex: 0, isActive: true }
];

const summaries: PlayerLedgerSummary[] = [
  {
    playerId: "p1",
    bankBuyInsCents: 0,
    bankCashOutsCents: 0,
    sentToPlayersCents: 0,
    receivedFromPlayersCents: 0,
    netCents: 0
  }
];

describe("CashOutPanel", () => {
  it("allows typing into the final chips field", () => {
    render(
      <CashOutPanel
        onAddTransaction={vi.fn()}
        players={players}
        readOnly={false}
        summaries={summaries}
        transactions={[]}
      />
    );

    const input = screen.getByLabelText("Final chips");

    fireEvent.change(input, { target: { value: "5" } });

    expect(input).toHaveValue("5");
  });

  it("clears the default final chips amount on focus", () => {
    render(
      <CashOutPanel
        onAddTransaction={vi.fn()}
        players={players}
        readOnly={false}
        summaries={summaries}
        transactions={[]}
      />
    );

    const input = screen.getByLabelText("Final chips");

    fireEvent.focus(input);

    expect(input).toHaveValue("");
  });
});
