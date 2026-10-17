import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { preloadGameApp } from "../components/GameApp";
import { createDefaultGameState } from "../state/seedGame";
import { STORAGE_KEY } from "../state/persistence";
import { LAST_VISIT_KEY } from "../session/localEntry";

function renderGameApp() {
  const result = render(<App />);
  const continueButton = screen.queryByRole("button", { name: /^Continue / });
  fireEvent.click(continueButton ?? screen.getByRole("button", { name: "Start new game" }));
  const playButton = screen.queryByRole("button", { name: "Play" });
  if (playButton && playButton.getAttribute("aria-pressed") !== "true") fireEvent.click(playButton);
  return result;
}

describe("App", () => {
  // Setup, Cash Out, Settle, and the audit drawer are lazy chunks; load them up front so mode switches render at once.
  beforeAll(async () => {
    await preloadGameApp();
  });

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(LAST_VISIT_KEY, String(Date.now()));
  });

  it("defaults to Play mode with the table, chip pool, and icon key visible", () => {
    renderGameApp();

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
    expect(screen.queryByRole("button", { name: "Rotate players left" }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reverse player order" }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rotate players right" }))
      .not.toBeInTheDocument();
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

  it("sets a Venmo username from the rename dialog", () => {
    renderGameApp();
    fireEvent.click(screen.getAllByTitle("Rename player")[0]);
    const dialog = screen.getByRole("dialog", { name: "Rename player" });
    const venmo = within(dialog).getByRole("textbox", { name: /Venmo username/ });
    expect(venmo).toHaveValue("");
    fireEvent.change(venmo, { target: { value: "no" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save name" }));
    expect(within(dialog).getByText(/5–30 letters/)).toBeInTheDocument();
    fireEvent.change(venmo, { target: { value: "@player-one" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save name" }));
    expect(screen.queryByRole("dialog", { name: "Rename player" })).not.toBeInTheDocument();

    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as { players: Array<{ venmoHandle?: string }> };
    expect(saved.players[0].venmoHandle).toBe("player-one");
  });

  it("switches to Setup mode and shows configuration plus player controls", () => {
    renderGameApp();

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
    renderGameApp();

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

  it("rotates and reverses players without moving the physical seats", () => {
    renderGameApp();

    fireEvent.click(screen.getByRole("button", { name: "Edit layout" }));
    const pokerSeating = screen.getByLabelText("Poker seating");
    const playerNamesInTableOrder = () =>
      within(pokerSeating)
        .getAllByRole("heading", { level: 3 })
        .map((heading) => heading.textContent);

    expect(playerNamesInTableOrder()).toEqual([
      "Player 1",
      "Player 2",
      "Player 3",
      "Player 4",
      "Player 5",
      "Player 6"
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Rotate players left" }));
    expect(playerNamesInTableOrder()).toEqual([
      "Player 2",
      "Player 3",
      "Player 4",
      "Player 5",
      "Player 6",
      "Player 1"
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Rotate players right" }));
    expect(playerNamesInTableOrder()).toEqual([
      "Player 1",
      "Player 2",
      "Player 3",
      "Player 4",
      "Player 5",
      "Player 6"
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Reverse player order" }));
    expect(playerNamesInTableOrder()).toEqual([
      "Player 6",
      "Player 5",
      "Player 4",
      "Player 3",
      "Player 2",
      "Player 1"
    ]);
  });

  it("uses list-oriented arrangement controls in the mobile player list", () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });

    try {
      renderGameApp();

      expect(screen.queryByRole("button", { name: "Edit layout" }))
        .not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Shift player order up" }))
        .toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Reverse player order" }))
        .toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Shift player order down" }))
        .toBeInTheDocument();

      const playerNames = () =>
        screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent);

      fireEvent.click(screen.getByRole("button", { name: "Shift player order up" }));
      expect(playerNames()).toEqual([
        "Player 2",
        "Player 3",
        "Player 4",
        "Player 5",
        "Player 6",
        "Player 1"
      ]);

      fireEvent.click(screen.getByRole("button", { name: "Shift player order down" }));
      expect(playerNames()).toEqual([
        "Player 1",
        "Player 2",
        "Player 3",
        "Player 4",
        "Player 5",
        "Player 6"
      ]);

      fireEvent.click(screen.getByRole("button", { name: "Reverse player order" }));
      expect(playerNames()).toEqual([
        "Player 6",
        "Player 5",
        "Player 4",
        "Player 3",
        "Player 2",
        "Player 1"
      ]);
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalInnerWidth
      });
    }
  });

  it("disables layout editing in read-only mode", () => {
    renderGameApp();

    fireEvent.click(screen.getByRole("button", { name: "Setup" }));
    fireEvent.click(screen.getByRole("button", { name: "Editable" }));
    fireEvent.click(screen.getByRole("button", { name: "Play" }));

    expect(screen.getByRole("button", { name: "Edit layout" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Rectangle" })).not.toBeInTheDocument();
  });

  it("switches to Cash Out mode and shows full-page player counting", () => {
    renderGameApp();

    fireEvent.click(screen.getByRole("button", { name: "Cash Out" }));

    expect(screen.getByRole("button", { name: "Cash Out" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "Cash Out" })).toBeInTheDocument();
    expect(screen.getByText(/Configure the Chip Value Key in Setup/)).toBeInTheDocument();
    expect(screen.queryByTitle("Record final chips")).not.toBeInTheDocument();
  });

  it("keeps Settle focused on settlement and transaction audit", () => {
    renderGameApp();

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

    renderGameApp();
    fireEvent.click(screen.getByRole("button", { name: "Settle" }));

    expect(screen.queryByText(/Missing cash-outs/)).not.toBeInTheDocument();
    expect(
      screen.getByText(/Chip pool balanced: .* Recorded partial cash-outs cover the pool\./)
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cover debt" })).toBeEnabled();
  });

  it("opens transaction entry as a Play drawer instead of permanent page content", () => {
    renderGameApp();

    expect(screen.queryByRole("heading", { name: "Add Transaction" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add transaction" }));

    expect(screen.getByRole("dialog", { name: "Add transaction" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Add Transaction" })).toBeInTheDocument();
  });

  it("opens transaction audit from Play", () => {
    renderGameApp();

    fireEvent.click(screen.getByRole("button", { name: "Transaction Audit" }));

    expect(screen.getByRole("dialog", { name: "Transaction audit" })).toBeInTheDocument();
  });

  it("adds the default buy-in to every active player from Play", () => {
    renderGameApp();

    fireEvent.click(screen.getByRole("button", { name: "Add default buy-in to all" }));

    const chipPool = screen.getByLabelText("Chip pool");
    expect(within(chipPool).getByText("Issued").nextElementSibling).toHaveTextContent(
      "$120.00"
    );
    expect(within(chipPool).getByText("In play").nextElementSibling).toHaveTextContent(
      "$120.00"
    );
    expect(screen.getAllByText("in for $20.00")).toHaveLength(6);
    expect(screen.queryByText(/owes/)).not.toBeInTheDocument();
  });

  it("shows a seat's loss only once the player's final count is recorded", () => {
    const state = createDefaultGameState();
    state.players = state.players.slice(0, 2);
    const [alex, blair] = state.players;
    state.transactions = [
      { id: "alex-buy-in", type: "bank_buy_in", createdAt: "2026-01-01T00:00:00.000Z", amountCents: 2000, toPlayerId: alex.id },
      { id: "blair-buy-in", type: "bank_buy_in", createdAt: "2026-01-01T00:01:00.000Z", amountCents: 2000, toPlayerId: blair.id },
      {
        id: "alex-final-cash-out",
        type: "bank_cash_out",
        cashOutKind: "final",
        createdAt: "2026-01-01T01:00:00.000Z",
        amountCents: 500,
        fromPlayerId: alex.id
      }
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

    renderGameApp();

    const alexSeat = screen.getByRole("heading", { name: alex.name }).closest("article")!;
    const blairSeat = screen.getByRole("heading", { name: blair.name }).closest("article")!;
    expect(within(alexSeat as HTMLElement).getByText("owes $15.00")).toHaveClass("negative");
    expect(within(blairSeat as HTMLElement).getByText("in for $20.00")).toHaveClass("neutral");
  });

  it("offers give-chips and covered-buy-in actions directly from a player card", () => {
    renderGameApp();

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
    renderGameApp();

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

    renderGameApp();
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

    const firstRender = renderGameApp();
    expect(screen.getByRole("button", { name: "Undo recent transaction action" })).toBeVisible();

    firstRender.unmount();
    renderGameApp();
    expect(screen.getByRole("button", { name: "Undo recent transaction action" })).toBeVisible();
  });

  it("changes the game currency from Setup and relabels every amount", () => {
    renderGameApp();
    fireEvent.click(screen.getByRole("button", { name: "Setup" }));

    const picker = screen.getByRole("combobox", { name: "Currency" });
    expect(picker).toHaveValue("USD");
    expect(within(picker).getByRole("option", { name: "EUR · Euro" })).toBeInTheDocument();

    // No transactions yet, so no confirmation is needed.
    const confirm = vi.spyOn(window, "confirm");
    fireEvent.change(picker, { target: { value: "EUR" } });
    expect(confirm).not.toHaveBeenCalled();
    expect(picker).toHaveValue("EUR");
    expect(screen.getByRole("button", { name: "Set buy-in to €50" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Set buy-in to $50" })).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null")).toMatchObject({
      schemaVersion: 8,
      settings: { currencyCode: "EUR" }
    });

    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(screen.getByText("Default buy-in €20.00")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add default buy-in to all" }));
    expect(within(screen.getAllByRole("region", { name: "Chip pool" })[0]).getAllByText(/€120\.00/).length)
      .toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/\$\d/);

    // With transactions recorded, switching asks first; declining keeps the currency.
    fireEvent.click(screen.getByRole("button", { name: "Setup" }));
    confirm.mockReturnValueOnce(false);
    fireEvent.change(screen.getByRole("combobox", { name: "Currency" }), { target: { value: "GBP" } });
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("nothing is converted"));
    expect(screen.getByRole("combobox", { name: "Currency" })).toHaveValue("EUR");

    confirm.mockReturnValueOnce(true);
    fireEvent.change(screen.getByRole("combobox", { name: "Currency" }), { target: { value: "GBP" } });
    expect(screen.getByRole("combobox", { name: "Currency" })).toHaveValue("GBP");
    expect(screen.getByRole("button", { name: "Set buy-in to £20" })).toHaveAttribute("aria-pressed", "true");
    confirm.mockRestore();
  });

  it("opens a saved game in its own currency", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(createDefaultGameState("CAD")));
    renderGameApp();
    fireEvent.click(screen.getByRole("button", { name: "Setup" }));
    expect(screen.getByRole("combobox", { name: "Currency" })).toHaveValue("CAD");
    expect(screen.getByRole("button", { name: "Set buy-in to CA$20" })).toBeInTheDocument();
  });
});
