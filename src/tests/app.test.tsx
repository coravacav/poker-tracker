import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { createDefaultGameState } from "../state/seedGame";
import { STORAGE_KEY } from "../state/persistence";
import { LAST_VISIT_KEY } from "../session/localEntry";

describe("App", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(LAST_VISIT_KEY, String(Date.now()));
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
      "Cash out",
      "Transaction",
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
    expect(screen.getByRole("button", { name: "Fast entry" })).toBeEnabled();
    expect(screen.getByRole("heading", { name: "Chip Value Key" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Table Layout" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit layout" })).not.toBeInTheDocument();
    expect(screen.queryByText("Corners")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Layout" })).not.toBeInTheDocument();

    for (const amount of [5, 10, 20, 50, 100]) {
      expect(
        screen.getByRole("button", { name: `Set buy-in to $${amount}` })
      ).toBeInTheDocument();
    }

    expect(screen.getByRole("button", { name: "Set buy-in to $20" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    fireEvent.click(screen.getByRole("button", { name: "Set buy-in to $50" }));
    expect(screen.getByRole("textbox", { name: "Buy-in" })).toHaveValue("50.00");
    expect(screen.getByRole("button", { name: "Set buy-in to $50" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null").settings.defaultBuyInCents)
      .toBe(5000);

    fireEvent.click(screen.getByRole("button", { name: "Fast entry" }));
    const fastEntry = screen.getByLabelText("Player names (one per line)");
    expect(fastEntry).toBeInTheDocument();

    fireEvent.change(fastEntry, { target: { value: "Alex\nBlair\nCasey" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply players" }));

    expect(
      screen.getAllByRole("textbox", { name: "Player name" }).map((input) =>
        (input as HTMLInputElement).value
      )
    ).toEqual(["Alex", "Blair", "Casey"]);

    fireEvent.click(screen.getByRole("button", { name: "Fast chip entry" }));
    const chipFastEntry = screen.getByLabelText(
      "Chip colors and values (one per line)"
    );
    fireEvent.change(chipFastEntry, { target: { value: "Red = 5\nBlue .25" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply to editor" }));

    expect(screen.getByLabelText("Red value")).toHaveValue("5.00");
    expect(screen.getByLabelText("Blue value")).toHaveValue("0.25");
    fireEvent.click(screen.getByRole("button", { name: "Save chip key" }));
    expect(screen.getByText("Chip value key saved.")).toBeInTheDocument();

    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    expect(persisted.settings.chipDenominations).toEqual([
      expect.objectContaining({ label: "Red", colorHex: "#ff0000", valueCents: 500 }),
      expect.objectContaining({ label: "Blue", colorHex: "#0000ff", valueCents: 25 })
    ]);
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

  it("accepts a zero chip pool after partial cash-outs recorded from Play", () => {
    const state = createDefaultGameState();
    state.players = state.players.slice(0, 2);
    const [alex, blair] = state.players;
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
        id: "alex-partial-cash-out",
        type: "bank_cash_out",
        cashOutKind: "partial",
        createdAt: "2026-01-01T01:00:00.000Z",
        amountCents: 1000,
        fromPlayerId: alex.id
      },
      {
        id: "blair-partial-cash-out",
        type: "bank_cash_out",
        cashOutKind: "partial",
        createdAt: "2026-01-01T01:01:00.000Z",
        amountCents: 3000,
        fromPlayerId: blair.id
      }
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Settle" }));

    expect(screen.queryByText(/Missing cash-outs/)).not.toBeInTheDocument();
    expect(
      screen.getByText("No chips remain in play; recorded partial cash-outs cover the pool.")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cover debt" })).toBeEnabled();
  });

  it("opens transaction entry as a Play drawer instead of permanent page content", () => {
    render(<App />);

    expect(screen.queryByRole("heading", { name: "Add Transaction" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add transaction" }));

    expect(screen.getByRole("dialog", { name: "Add transaction" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Add Transaction" })).toBeInTheDocument();
  });

  it("opens transaction audit from Play", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Transaction Audit" }));

    expect(screen.getByRole("dialog", { name: "Transaction audit" })).toBeInTheDocument();
  });

  it("adds the default buy-in to every active player from Play", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Add default buy-in to all" }));

    const chipPool = screen.getByLabelText("Chip pool");
    expect(within(chipPool).getByText("Issued").nextElementSibling).toHaveTextContent(
      "$120.00"
    );
    expect(within(chipPool).getByText("In play").nextElementSibling).toHaveTextContent(
      "$120.00"
    );
    expect(screen.getAllByText("owes $20.00")).toHaveLength(6);
  });

  it("offers give-chips and covered-buy-in actions directly from a player card", () => {
    render(<App />);

    fireEvent.click(screen.getAllByTitle("Start player transaction")[0]);
    const dialog = screen.getByRole("dialog", { name: "Player transaction" });
    expect(within(dialog).getByRole("button", { name: "Player gave" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(within(dialog).getByRole("button", { name: "Record player gave" }))
      .toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Player owes" })).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cover buy-in" }));
    expect(within(dialog).getByLabelText("Covered by")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Chips to")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Covered buy-in preview")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Record covered buy-in" }))
      .toBeInTheDocument();
    expect(within(dialog).queryByText(/Food/)).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Add transaction" })).not.toBeInTheDocument();
  });

  it("records a confirmed partial cash-out from a player card", () => {
    render(<App />);

    fireEvent.click(screen.getAllByTitle("Record partial cash-out")[0]);
    const dialog = screen.getByRole("dialog", { name: "Partial cash-out" });
    expect(within(dialog).getByRole("heading", { name: "Cash out Player 1" }))
      .toBeInTheDocument();
    expect(within(dialog).getByLabelText("Amount")).toHaveValue("20.00");

    fireEvent.change(within(dialog).getByLabelText("Amount"), { target: { value: "0" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Record partial cash-out" }));
    expect(within(dialog).getByText("Enter a positive cash-out amount.")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "1/4 buy-in $5.00" }));
    expect(within(dialog).getByLabelText("Partial cash-out preview")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Record partial cash-out" }));
    expect(screen.queryByRole("dialog", { name: "Partial cash-out" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cash Out" }));
    expect(screen.getByText("0 / 6")).toBeInTheDocument();
    expect(screen.getByText("Cashed out earlier")).toBeInTheDocument();
    expect(screen.queryByText(/multiple active cash-outs/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Settle" }));
    fireEvent.click(screen.getByRole("button", { name: "Transaction Audit" }));
    expect(screen.getByRole("heading", { name: "Partial cash-out" })).toBeInTheDocument();
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
        cashOutKind: "final",
        createdAt: "2026-01-01T01:00:00.000Z",
        amountCents: 0,
        fromPlayerId: alex.id
      },
      {
        id: "blair-cash-out",
        type: "bank_cash_out",
        cashOutKind: "final",
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

  it("keeps a recent transaction undoable after refreshing from persisted state", () => {
    const state = createDefaultGameState();
    state.transactions = [
      {
        id: "recent",
        type: "bank_buy_in",
        createdAt: new Date().toISOString(),
        amountCents: 2000,
        toPlayerId: state.players[0].id
      }
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

    const firstRender = render(<App />);
    expect(screen.getByRole("button", { name: "Undo recent transaction action" })).toBeVisible();

    firstRender.unmount();
    render(<App />);
    expect(screen.getByRole("button", { name: "Undo recent transaction action" })).toBeVisible();
  });
});
