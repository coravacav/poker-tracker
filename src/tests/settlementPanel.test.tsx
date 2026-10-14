import { fireEvent, render, screen, within } from "@testing-library/react";
import { useReducer } from "react";
import { describe, expect, it, vi } from "vitest";
import { SettlementPanel } from "../components/SettlementPanel";
import type { BankSummary, Player, PlayerLedgerSummary } from "../domain/pokerTypes";
import { gameReducer } from "../state/gameReducer";
import { createDefaultGameState } from "../state/seedGame";

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

/** Routes pin actions through the real reducer, like the app does. */
function PinHarness() {
  const [state, dispatch] = useReducer(gameReducer, undefined, () => ({
    ...createDefaultGameState(),
    players
  }));
  return (
    <SettlementPanel
      bankSummary={bankSummary}
      imbalanceCents={0}
      onAddTransaction={vi.fn(() => true)}
      onSettlementPinAction={dispatch}
      players={state.players}
      readOnly={false}
      settlementPins={state.settlementPins}
      settlementReady={true}
      summaries={summaries}
    />
  );
}

describe("SettlementPanel", () => {
  it("marks payments paid through pins and clears the marks", () => {
    render(<PinHarness />);

    expect(screen.getByText("0 of 2 payments settled")).toBeInTheDocument();

    const paymentCheckbox = screen.getByRole("checkbox", {
      name: "Mark Alex to Casey $20.00 as paid"
    });
    fireEvent.click(paymentCheckbox);

    const paidCheckbox = screen.getByRole("checkbox", {
      name: "Mark Alex to Casey $20.00 as unpaid"
    });
    expect(paidCheckbox).toBeChecked();
    expect(screen.getByText("1 of 2 payments settled")).toBeInTheDocument();
    expect(screen.getByText("Paid")).toBeInTheDocument();
    // The other payment is still suggested and unchanged.
    expect(
      screen.getByRole("checkbox", { name: "Mark Alex to Blair $10.00 as paid" })
    ).not.toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "Clear marks" }));

    expect(
      screen.getByRole("checkbox", { name: "Mark Alex to Casey $20.00 as paid" })
    ).not.toBeChecked();
    expect(screen.getByText("0 of 2 payments settled")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear marks" })).not.toBeInTheDocument();
  });

  it("locks a payment, then marks the locked payment paid", () => {
    render(<PinHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Lock Alex to Blair $10.00" }));
    const unlock = screen.getByRole("button", { name: "Unlock Alex to Blair $10.00" });
    expect(unlock).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Locked")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "Mark Alex to Blair $10.00 as paid" }));
    expect(screen.getByText("1 of 2 payments settled")).toBeInTheDocument();
    expect(screen.queryByText("Locked")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Unlock Alex to Blair/ })).not.toBeInTheDocument();

    // Unchecking a paid payment returns it to the suggested plan.
    fireEvent.click(screen.getByRole("checkbox", { name: "Mark Alex to Blair $10.00 as unpaid" }));
    expect(screen.getByText("0 of 2 payments settled")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lock Alex to Blair $10.00" })).toBeInTheDocument();
  });

  it("adds a custom payment and plans the rest around it", () => {
    render(<PinHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Add payment" }));
    const form = screen.getByRole("form", { name: "Add a fixed payment" });
    fireEvent.change(within(form).getByLabelText("Payer"), { target: { value: "alex" } });
    fireEvent.change(within(form).getByLabelText("Recipient"), { target: { value: "blair" } });
    fireEvent.change(within(form).getByLabelText("Amount"), { target: { value: "30" } });
    fireEvent.click(within(form).getByLabelText("Already paid"));
    fireEvent.click(within(form).getByRole("button", { name: "Add payment" }));

    expect(screen.queryByRole("form", { name: "Add a fixed payment" })).not.toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Mark Alex to Blair $30.00 as unpaid" })
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Mark Blair to Casey $20.00 as paid" })
    ).not.toBeChecked();
    expect(screen.getByText("1 of 2 payments settled")).toBeInTheDocument();
    expect(screen.getByText(/more than Blair owes or is owed/)).toBeInTheDocument();
  });

  it("rejects an invalid custom payment", () => {
    render(<PinHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Add payment" }));
    const form = screen.getByRole("form", { name: "Add a fixed payment" });
    fireEvent.change(within(form).getByLabelText("Recipient"), { target: { value: "alex" } });
    fireEvent.change(within(form).getByLabelText("Payer"), { target: { value: "alex" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add payment" }));
    expect(screen.getByText("Choose two different players.")).toBeInTheDocument();

    fireEvent.change(within(form).getByLabelText("Recipient"), { target: { value: "casey" } });
    fireEvent.change(within(form).getByLabelText("Amount"), { target: { value: "0" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add payment" }));
    expect(screen.getByText("Enter an amount greater than zero.")).toBeInTheDocument();
    expect(screen.getByText("0 of 2 payments settled")).toBeInTheDocument();
  });

  it("shows pinned payments to guests without controls", () => {
    render(
      <SettlementPanel
        bankSummary={bankSummary}
        hideActions
        imbalanceCents={0}
        onAddTransaction={vi.fn(() => true)}
        players={players}
        readOnly
        settlementPins={[
          { id: "pin", fromPlayerId: "alex", toPlayerId: "casey", amountCents: 2000, status: "paid" }
        ]}
        settlementReady={true}
        summaries={summaries}
      />
    );

    expect(screen.getByText("1 of 2 payments settled")).toBeInTheDocument();
    expect(screen.getByText("Paid")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Lock/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add payment" })).not.toBeInTheDocument();
  });

  it("disables payment marks in read-only mode", () => {
    const onSettlementPinAction = vi.fn();
    render(
      <SettlementPanel
        bankSummary={bankSummary}
        imbalanceCents={0}
        onAddTransaction={vi.fn(() => true)}
        onSettlementPinAction={onSettlementPinAction}
        players={players}
        readOnly
        settlementReady={true}
        summaries={summaries}
      />
    );

    const checkbox = screen.getByRole("checkbox", { name: "Mark Alex to Casey $20.00 as paid" });
    expect(checkbox).toBeDisabled();
    fireEvent.click(checkbox);
    expect(onSettlementPinAction).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Add payment" })).toBeDisabled();
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
