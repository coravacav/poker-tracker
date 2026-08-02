import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChipDenominationPanel } from "../components/ChipDenominationPanel";
import type { ChipDenomination } from "../domain/pokerTypes";

const denominations: ChipDenomination[] = [
  { id: "blue", label: "Blue", colorHex: "#1122ff", valueCents: 500 },
  { id: "red", label: "Red", colorHex: "#ff0000", valueCents: 100 }
];

function renderPanel(
  changes: Partial<React.ComponentProps<typeof ChipDenominationPanel>> = {}
) {
  const props: React.ComponentProps<typeof ChipDenominationPanel> = {
    denominations: [],
    dispatch: vi.fn(),
    readOnly: false,
    ...changes
  };

  return { ...render(<ChipDenominationPanel {...props} />), props };
}

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

  it("accepts and normalizes a leading-decimal chip value", () => {
    const dispatch = vi.fn();
    render(<ChipDenominationPanel denominations={[]} dispatch={dispatch} readOnly={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Add chip" }));
    fireEvent.change(screen.getByLabelText("Chip color name"), { target: { value: "Blue" } });
    fireEvent.change(screen.getByLabelText("Blue value"), { target: { value: ".25" } });
    fireEvent.change(screen.getByLabelText("Blue color"), { target: { value: "#0000ff" } });
    fireEvent.click(screen.getByRole("button", { name: "Save chip key" }));

    expect(dispatch).toHaveBeenCalledWith({
      type: "set_chip_denominations",
      denominations: [expect.objectContaining({ label: "Blue", colorHex: "#0000ff", valueCents: 25 })]
    });
    expect(screen.queryByText("Enter a positive value for Blue.")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Blue value")).toHaveValue("0.25");
  });

  it("disables mutations in read-only mode", () => {
    renderPanel({ readOnly: true });
    expect(screen.getByRole("button", { name: "Fast chip entry" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add chip" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save chip key" })).toBeDisabled();
  });

  it("opens empty fast entry and cancels without changing the editor", () => {
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Fast chip entry" }));

    expect(screen.getByLabelText("Chip colors and values (one per line)")).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Save chip key" })).toBeNull();
    expect(screen.getByRole("button", { name: "Add chip" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByLabelText("Chip colors and values (one per line)")).toBeNull();
    expect(screen.getByText(/No chip colors configured/)).toBeInTheDocument();
  });

  it("prefills current unsaved and partially completed rows", () => {
    renderPanel({ denominations: [denominations[0]] });
    fireEvent.change(screen.getByLabelText("Blue value"), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Add chip" }));
    fireEvent.change(screen.getAllByLabelText("Chip color name")[1], {
      target: { value: "Mystery" }
    });

    fireEvent.click(screen.getByRole("button", { name: "Fast chip entry" }));

    expect(screen.getByLabelText("Chip colors and values (one per line)")).toHaveValue(
      "Blue = 7\nMystery = "
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByLabelText("Blue value")).toHaveValue("7");
    expect(screen.getByLabelText("Mystery value")).toHaveValue("");
  });

  it("keeps fast entry open and does not dispatch when parsing fails", () => {
    const dispatch = vi.fn();
    renderPanel({ dispatch });
    fireEvent.click(screen.getByRole("button", { name: "Fast chip entry" }));
    fireEvent.change(screen.getByLabelText("Chip colors and values (one per line)"), {
      target: { value: "Red = nope" }
    });

    fireEvent.click(screen.getByRole("button", { name: "Apply to editor" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Line 1: enter a positive USD value for Red."
    );
    expect(screen.getByLabelText("Chip colors and values (one per line)")).toBeVisible();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("replaces editable rows while preserving matching identities and custom colors", () => {
    const dispatch = vi.fn();
    renderPanel({ denominations, dispatch });
    fireEvent.click(screen.getByRole("button", { name: "Fast chip entry" }));
    fireEvent.change(screen.getByLabelText("Chip colors and values (one per line)"), {
      target: { value: "Blue = 10\nGreen .25\nCerulean, 2" }
    });

    fireEvent.click(screen.getByRole("button", { name: "Apply to editor" }));

    expect(dispatch).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Red value")).toBeNull();
    expect(screen.getByLabelText("Blue color")).toHaveValue("#1122ff");
    expect(screen.getByLabelText("Green color")).toHaveValue("#008000");
    expect(screen.getByLabelText("Cerulean color")).toHaveValue("#ffffff");
    expect(screen.getByLabelText("Blue value")).toHaveValue("10.00");
    expect(screen.getByLabelText("Green value")).toHaveValue("0.25");
    expect(screen.getByLabelText("Cerulean value")).toHaveValue("2.00");

    fireEvent.click(screen.getByRole("button", { name: "Save chip key" }));

    expect(dispatch).toHaveBeenCalledWith({
      type: "set_chip_denominations",
      denominations: [
        { id: "blue", label: "Blue", colorHex: "#1122ff", valueCents: 1000 },
        expect.objectContaining({ label: "Green", colorHex: "#008000", valueCents: 25 }),
        expect.objectContaining({ label: "Cerulean", colorHex: "#ffffff", valueCents: 200 })
      ]
    });
  });

  it("requires fallback swatches to be made unique before saving", () => {
    const dispatch = vi.fn();
    renderPanel({ dispatch });
    fireEvent.click(screen.getByRole("button", { name: "Fast chip entry" }));
    fireEvent.change(screen.getByLabelText("Chip colors and values (one per line)"), {
      target: { value: "Cerulean = 5\nChartreuse = 10" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply to editor" }));

    fireEvent.click(screen.getByRole("button", { name: "Save chip key" }));

    expect(screen.getByText("Chip colors must be unique.")).toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("closes fast entry without changing rows when read-only mode activates", () => {
    const { rerender, props } = renderPanel({ denominations: [denominations[0]] });
    fireEvent.click(screen.getByRole("button", { name: "Fast chip entry" }));
    fireEvent.change(screen.getByLabelText("Chip colors and values (one per line)"), {
      target: { value: "Red = 50" }
    });

    rerender(<ChipDenominationPanel {...props} readOnly />);

    expect(screen.queryByLabelText("Chip colors and values (one per line)")).toBeNull();
    expect(screen.getByLabelText("Blue value")).toHaveValue("5.00");
  });
});
