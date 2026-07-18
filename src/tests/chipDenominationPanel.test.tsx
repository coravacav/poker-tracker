import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChipDenominationPanel } from "../components/ChipDenominationPanel";

describe("ChipDenominationPanel", () => {
  it("builds and validates a freeform chip key", () => {
    const dispatch = vi.fn();
    render(<ChipDenominationPanel denominations={[]} dispatch={dispatch} readOnly={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Add chip" }));
    fireEvent.change(screen.getByLabelText("Chip color name"), { target: { value: "Blue" } });
    fireEvent.change(screen.getByLabelText("Blue value"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Blue color"), { target: { value: "#0000ff" } });
    fireEvent.click(screen.getByRole("button", { name: "Save chip key" }));

    expect(dispatch).toHaveBeenCalledWith({
      type: "set_chip_denominations",
      denominations: [expect.objectContaining({ label: "Blue", colorHex: "#0000ff", valueCents: 500 })]
    });
  });

  it("disables mutations in read-only mode", () => {
    render(<ChipDenominationPanel denominations={[]} dispatch={vi.fn()} readOnly />);
    expect(screen.getByRole("button", { name: "Add chip" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save chip key" })).toBeDisabled();
  });
});
