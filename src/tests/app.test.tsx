import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../App";

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
    ).toEqual(["Edit layout", "Setup", "Play", "Settle"]);

    expect(screen.getByRole("heading", { name: "Table Layout" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit layout" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rectangle" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Oval" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Round" })).not.toBeInTheDocument();
    expect(screen.queryByTitle("Drag to move physical seat")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Drag to move player")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Chip Pool" })).toBeInTheDocument();

    const iconKey = screen.getByLabelText("Card icon key");
    for (const label of [
      "Rename",
      "Buy-in",
      "Transfer",
      "Final chips",
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
    expect(screen.queryByRole("heading", { name: "Table Layout" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit layout" })).not.toBeInTheDocument();
    expect(screen.queryByText("Corners")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Layout" })).not.toBeInTheDocument();
  });

  it("changes shape and shows layout insertion targets in edit mode", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Edit layout" }));

    expect(screen.getAllByTitle("Drag to move physical seat").length).toBeGreaterThan(0);
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

  it("switches to Settle mode and opens chip count and audit drawers", () => {
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

    fireEvent.click(screen.getByRole("button", { name: "Chip Counts" }));
    expect(screen.getByRole("dialog", { name: "Chip counts" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

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
});
