import { describe, expect, it } from "vitest";
import {
  parseChipFastEntry,
  suggestedChipColorHex
} from "../domain/chipKeyFastEntry";

describe("chip key fast entry", () => {
  it("parses every supported separator and money format", () => {
    expect(
      parseChipFastEntry(
        "Red = 5\r\nLight   Blue: .25\rBlack, $100\nGreen\t1,000\nPurple $ 10.50"
      )
    ).toEqual({
      ok: true,
      items: [
        { label: "Red", valueCents: 500 },
        { label: "Light Blue", valueCents: 25 },
        { label: "Black", valueCents: 10000 },
        { label: "Green", valueCents: 100000 },
        { label: "Purple", valueCents: 1050 }
      ]
    });
  });

  it("preserves a thousands separator in whitespace-delimited values", () => {
    expect(parseChipFastEntry("Black $1,000")).toEqual({
      ok: true,
      items: [{ label: "Black", valueCents: 100000 }]
    });
  });

  it("ignores blank lines and reports original line numbers", () => {
    expect(parseChipFastEntry("\nRed = 5\n\nBlue = nope")).toEqual({
      ok: false,
      error: "Line 4: enter a positive USD value for Blue."
    });
  });

  it("rejects empty, incomplete, nonpositive, and over-precision input", () => {
    expect(parseChipFastEntry(" \n ")).toEqual({
      ok: false,
      error: "Enter at least one chip color and value."
    });
    expect(parseChipFastEntry("Red")).toEqual({
      ok: false,
      error: "Line 1: use “Color = value” (for example, “Red = 5”)."
    });
    expect(parseChipFastEntry("= 5")).toEqual({
      ok: false,
      error: "Line 1: enter a chip color name."
    });
    for (const input of ["Red =", "Red = 0", "Red = -5", "Red = 1.234"]) {
      expect(parseChipFastEntry(input)).toEqual({
        ok: false,
        error: "Line 1: enter a positive USD value for Red."
      });
    }
  });

  it("rejects duplicate names case-insensitively", () => {
    expect(parseChipFastEntry("Light Blue = 5\n light   blue = 10")).toEqual({
      ok: false,
      error: "Line 2: chip color name “light blue” duplicates an earlier line."
    });
  });

  it("maps common colors and aliases while defaulting unknown names to white", () => {
    expect(suggestedChipColorHex(" red ")).toBe("#ff0000");
    expect(suggestedChipColorHex("DARK   BLUE")).toBe("#000080");
    expect(suggestedChipColorHex("grey")).toBe("#808080");
    expect(suggestedChipColorHex("cyan")).toBe("#00ffff");
    expect(suggestedChipColorHex("Cerulean")).toBe("#ffffff");
  });
});
