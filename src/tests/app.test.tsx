import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "../App";

describe("App", () => {
  it("renders the main poker tracker workflow", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "Poker Tracker" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Table Layout" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Add Transaction" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Settlement" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Oval - top/bottom" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Rectangle" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Layout"), {
      target: { value: "rectangle" }
    });

    expect(screen.getByLabelText("Corners")).toBeChecked();
  });
});
