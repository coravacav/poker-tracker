import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { createDefaultGameState } from "../state/seedGame";
import { STORAGE_KEY } from "../state/persistence";

describe("App", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to Play mode with the table, chip pool, and icon key visible", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "Poker Tracker" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Setup" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("button", { name: "Settle" })).toBeInTheDocument();
    expect(
      within(screen.getByRole("navigation", { name: "Poker tracker modes" }))
        .getAllByRole("button")
        .map((button) => button.textContent)
    ).toEqual(["Edit layout", "Setup", "Play", "Cash Out", "Settle"]);

    expect(screen.getByRole("heading", { name: "Table Layout" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit layout" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rectangle" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Oval" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Round" })).not.toBeInTheDocument();
    expect(screen.queryByTitle("Drag to move physical seat")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Drag to move player")).not.toBeInTheDocument();
    expect(screen.queryByText("Seat 1")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Chip Pool" })).toBeInTheDocument();

    const iconKey = screen.getByLabelText("Card icon key");
    for (const label of [
      "Rename",
      "Buy-in",
      "Transfer",
      "Drag transfer"
    ]) {
      expect(within(iconKey).getByText(label)).toBeInTheDocument();
    }
    expect(within(iconKey).queryByText("Move seat")).not.toBeInTheDocument();

    expect(screen.queryByRole("heading", { name: "Add Transaction" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Transaction Audit" })).not.toBeInTheDocument();
  });

  it("switches to Setup mode and shows configuration plus player controls", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Setup" }));

    expect(screen.getByRole("button", { name: "Setup" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("heading", { name: "Game Setup" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Players" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Chip Value Key" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Table Layout" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit layout" })).not.toBeInTheDocument();
    expect(screen.queryByText("Corners")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Layout" })).not.toBeInTheDocument();
  });

  it("changes shape and shows layout insertion targets in edit mode", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Edit layout" }));

    expect(screen.getAllByTitle("Drag to move physical seat").length).toBeGreaterThan(0);
    expect(screen.getByText("Seat 1")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Card icon key")).getByText("Move seat"))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rectangle" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    fireEvent.click(screen.getByRole("button", { name: "Oval" }));
    expect(screen.getByRole("button", { name: "Oval" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    expect(screen.getByRole("button", { name: "Move seat to top position 1" }))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move seat to bottom position 4" }))
      .toBeInTheDocument();
  });

  it("disables layout editing in read-only mode", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Setup" }));
    fireEvent.click(screen.getByRole("button", { name: "Editable" }));
    fireEvent.click(screen.getByRole("button", { name: "Play" }));

    expect(screen.getByRole("button", { name: "Edit layout" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Rectangle" })).not.toBeInTheDocument();
  });

  it("switches to Cash Out mode and shows full-page player counting", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Cash Out" }));

    expect(screen.getByRole("button", { name: "Cash Out" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "Cash Out" })).toBeInTheDocument();
    expect(screen.getByText(/Configure the Chip Value Key in Setup/)).toBeInTheDocument();
    expect(screen.queryByTitle("Record final chips")).not.toBeInTheDocument();
  });

  it("keeps Settle focused on settlement and transaction audit", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Settle" }));

    expect(screen.getByRole("button", { name: "Settle" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.queryByRole("button", { name: "Edit layout" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Settlement" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Player Payments" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Player Net" })).toBeInTheDocument();

    expect(screen.queryByRole("button", { name: "Chip Counts" })).not.toBeInTheDocument();
    expect(screen.getByText(/Missing cash-outs/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Transaction Audit" }));
    expect(screen.getByRole("dialog", { name: "Transaction audit" })).toBeInTheDocument();
  });

  it("opens transaction entry as a Play drawer instead of permanent page content", () => {
    render(<App />);

    expect(screen.queryByRole("heading", { name: "Add Transaction" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add transaction" }));

    expect(screen.getByRole("dialog", { name: "Add transaction" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Add Transaction" })).toBeInTheDocument();
  });

  it("offers give-chips and covered-buy-in actions directly from a player card", () => {
    render(<App />);

    fireEvent.click(screen.getAllByTitle("Start player transfer")[0]);
    const dialog = screen.getByRole("dialog", { name: "Player transfer" });
    expect(within(dialog).getByRole("button", { name: "Give chips" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(within(dialog).getByRole("button", { name: "Record chip transfer" }))
      .toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cover buy-in" }));
    expect(within(dialog).getByLabelText("Covered by")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Chips to")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Covered buy-in preview")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Record covered buy-in" }))
      .toBeInTheDocument();
    expect(within(dialog).queryByText(/Food/)).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Add transaction" })).not.toBeInTheDocument();
  });

  it("records a settlement-ready full debt coverage and recalculates payments", () => {
    const state = createDefaultGameState();
    state.players = state.players.slice(0, 2);
    const [alex, blair] = state.players;
    alex.name = "Alex";
    blair.name = "Blair";
    state.transactions = [
      {
        id: "alex-buy-in",
        type: "bank_buy_in",
        createdAt: "2026-01-01T00:00:00.000Z",
        amountCents: 2000,
        toPlayerId: alex.id
      },
      {
        id: "blair-buy-in",
        type: "bank_buy_in",
        createdAt: "2026-01-01T00:01:00.000Z",
        amountCents: 2000,
        toPlayerId: blair.id
      },
      {
        id: "alex-cash-out",
        type: "bank_cash_out",
        createdAt: "2026-01-01T01:00:00.000Z",
        amountCents: 0,
        fromPlayerId: alex.id
      },
      {
        id: "blair-cash-out",
        type: "bank_cash_out",
        createdAt: "2026-01-01T01:01:00.000Z",
        amountCents: 4000,
        fromPlayerId: blair.id
      }
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Settle" }));
    fireEvent.click(screen.getByRole("button", { name: "Cover debt" }));
    fireEvent.click(screen.getByRole("button", { name: "Record debt coverage" }));

    expect(screen.getByText("No player-to-player payments needed.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Transaction Audit" }));
    expect(screen.getByRole("heading", { name: "Debt coverage" })).toBeInTheDocument();
    expect(screen.getByText("Blair covers Alex")).toBeInTheDocument();
  });
});
