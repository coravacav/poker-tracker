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

    expect(screen.getByRole("heading", { name: "Table Layout" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Chip Pool" })).toBeInTheDocument();

    const iconKey = screen.getByLabelText("Card icon key");
    for (const label of [
      "Move seat",
      "Rename",
      "Buy-in",
      "Transfer",
      "Final chips",
      "Drag transfer"
    ]) {
      expect(within(iconKey).getByText(label)).toBeInTheDocument();
    }

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
  });

  it("switches to Settle mode and opens chip count and audit drawers", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Settle" }));

    expect(screen.getByRole("button", { name: "Settle" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
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
