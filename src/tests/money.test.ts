import { describe, expect, it } from "vitest";
import { formatCurrency, parseMoneyToCents } from "../domain/money";

describe("money", () => {
  it("parses whole and decimal dollar values", () => {
    expect(parseMoneyToCents("$20")).toBe(2000);
    expect(parseMoneyToCents("20")).toBe(2000);
    expect(parseMoneyToCents("20.50")).toBe(2050);
  });

  it("rejects invalid and negative values", () => {
    expect(parseMoneyToCents("-20")).toBeNull();
    expect(parseMoneyToCents("20.999")).toBeNull();
    expect(parseMoneyToCents("abc")).toBeNull();
  });

  it("formats cents as USD", () => {
    expect(formatCurrency(2050)).toBe("$20.50");
  });
});
