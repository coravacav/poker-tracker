import { describe, expect, it, vi } from "vitest";
import {
  CURRENCY_NAMES,
  SUPPORTED_CURRENCY_CODES,
  describeSignedMoney,
  formatCurrency,
  formatPlainCurrency,
  isSupportedCurrencyCode,
  parseMoneyToCents,
  toCurrencyCode
} from "../domain/money";

describe("money", () => {
  it("parses whole and decimal dollar values", () => {
    expect(parseMoneyToCents("$20")).toBe(2000);
    expect(parseMoneyToCents("20")).toBe(2000);
    expect(parseMoneyToCents("20.50")).toBe(2050);
    expect(parseMoneyToCents("20.")).toBe(2000);
  });

  it("parses leading-decimal dollar values", () => {
    expect(parseMoneyToCents(".25")).toBe(25);
    expect(parseMoneyToCents(".5")).toBe(50);
    expect(parseMoneyToCents("$.25")).toBe(25);
  });

  it("rejects invalid and negative values", () => {
    expect(parseMoneyToCents("")).toBeNull();
    expect(parseMoneyToCents(".")).toBeNull();
    expect(parseMoneyToCents(",")).toBeNull();
    expect(parseMoneyToCents("-20")).toBeNull();
    expect(parseMoneyToCents("-.25")).toBeNull();
    expect(parseMoneyToCents("$-20")).toBeNull();
    expect(parseMoneyToCents("20.999")).toBeNull();
    expect(parseMoneyToCents(".255")).toBeNull();
    expect(parseMoneyToCents("abc")).toBeNull();
    expect(parseMoneyToCents("$20$")).toBeNull();
  });

  it("keeps comma thousands separators with dot decimals", () => {
    expect(parseMoneyToCents("1,234")).toBe(123400);
    expect(parseMoneyToCents("1,234.50")).toBe(123450);
    expect(parseMoneyToCents("$1,234,567.89")).toBe(123456789);
    expect(parseMoneyToCents("1,000")).toBe(100000);
    // Indian grouping
    expect(parseMoneyToCents("1,23,456.50")).toBe(12345650);
  });

  it("accepts comma decimals for comma-decimal locales", () => {
    expect(parseMoneyToCents("12,50")).toBe(1250);
    expect(parseMoneyToCents("12,5")).toBe(1250);
    expect(parseMoneyToCents("0,25")).toBe(25);
    expect(parseMoneyToCents(",25")).toBe(25);
    expect(parseMoneyToCents("1.234,50")).toBe(123450);
    expect(parseMoneyToCents("1.234.567,89")).toBe(123456789);
    expect(parseMoneyToCents("€12,50")).toBe(1250);
    expect(parseMoneyToCents("12,50 €")).toBe(1250);
    expect(parseMoneyToCents("£ 7.25")).toBe(725);
  });

  it("accepts space and apostrophe thousands separators in strict groups", () => {
    expect(parseMoneyToCents("1 234,50")).toBe(123450);
    expect(parseMoneyToCents("1 234,50")).toBe(123450);
    expect(parseMoneyToCents("1 234")).toBe(123400);
    expect(parseMoneyToCents("1'234.50")).toBe(123450);
    expect(parseMoneyToCents("12 34")).toBeNull();
  });

  it("rejects ambiguous or malformed separators instead of guessing", () => {
    // A dot followed by three digits could be a thousands separator or a typo; never guess.
    expect(parseMoneyToCents("1.234")).toBeNull();
    expect(parseMoneyToCents("1,234,50")).toBeNull();
    expect(parseMoneyToCents("12,345,6")).toBeNull();
    expect(parseMoneyToCents("1,2,3")).toBeNull();
    expect(parseMoneyToCents("12,505")).toBe(1250500);
    expect(parseMoneyToCents("12,5050")).toBeNull();
    expect(parseMoneyToCents("1.234.50")).toBeNull();
    expect(parseMoneyToCents("1,234.5.0")).toBeNull();
    expect(parseMoneyToCents("12,50.00")).toBeNull();
    expect(parseMoneyToCents("1.234,567")).toBeNull();
  });

  it("formats cents as USD by default", () => {
    expect(formatCurrency(2050)).toBe("$20.50");
    expect(formatCurrency(-2050, "USD", { locale: "en-US" })).toBe("-$20.50");
  });

  it("supports only currencies with two minor digits", () => {
    for (const code of SUPPORTED_CURRENCY_CODES) {
      const options = new Intl.NumberFormat("en-US", { style: "currency", currency: code }).resolvedOptions();
      expect(options.maximumFractionDigits, code).toBe(2);
      expect(options.minimumFractionDigits, code).toBe(2);
      expect(CURRENCY_NAMES[code]).toBeTruthy();
    }
    expect(new Set(SUPPORTED_CURRENCY_CODES).size).toBe(SUPPORTED_CURRENCY_CODES.length);
  });

  it("formats each currency for the given locale", () => {
    expect(formatCurrency(123450, "EUR", { locale: "en-US" })).toBe("€1,234.50");
    expect(formatCurrency(123450, "EUR", { locale: "de-DE" })).toBe("1.234,50 €");
    expect(formatCurrency(2050, "GBP", { locale: "en-GB" })).toBe("£20.50");
    expect(formatCurrency(2050, "USD", { locale: "en-GB" })).toBe("US$20.50");
    expect(formatCurrency(2050, "CAD", { locale: "en-US" })).toBe("CA$20.50");
    expect(formatCurrency(2050, "INR", { locale: "en-IN" })).toBe("₹20.50");
    for (const code of SUPPORTED_CURRENCY_CODES) {
      expect(formatCurrency(1, code, { locale: "en-US" }), code).toMatch(/0\.01/);
    }
  });

  it("trims whole amounts only when asked", () => {
    expect(formatCurrency(5000, "EUR", { locale: "en-US", trimWholeCents: true })).toBe("€50");
    expect(formatCurrency(5050, "EUR", { locale: "en-US", trimWholeCents: true })).toBe("€50.50");
    expect(formatCurrency(0, "USD", { locale: "en-US", trimWholeCents: true })).toBe("$0");
  });

  it("uses the browser language when no locale is given", () => {
    const language = vi.spyOn(navigator, "language", "get").mockReturnValue("de-DE");
    try {
      expect(formatCurrency(123450, "EUR")).toBe("1.234,50\u00a0€");
    } finally {
      language.mockRestore();
    }
    expect(formatCurrency(123450, "EUR")).toBe("€1,234.50");
  });

  it("never throws for unknown currency codes", () => {
    expect(isSupportedCurrencyCode("JPY")).toBe(false);
    expect(isSupportedCurrencyCode("usd")).toBe(false);
    expect(isSupportedCurrencyCode(undefined)).toBe(false);
    expect(toCurrencyCode("nope")).toBe("USD");
    expect(toCurrencyCode("SEK")).toBe("SEK");
    expect(formatCurrency(1250, "XX!")).toBe("12.50");
    expect(formatCurrency(1250, "JPY")).toBe("12.50 JPY");
  });

  it("formats plain locale-independent text for shared audit summaries", () => {
    expect(formatPlainCurrency(2050, "USD")).toBe("$20.50");
    expect(formatPlainCurrency(5, "EUR")).toBe("0.05 EUR");
    expect(formatPlainCurrency(-123456, "GBP")).toBe("-1234.56 GBP");
  });

  it("describes signed balances in the game's currency", () => {
    expect(describeSignedMoney(2000, "EUR", { locale: "en-US" })).toBe("owed €20.00");
    expect(describeSignedMoney(-2000, "GBP", { locale: "en-US" })).toBe("owes £20.00");
    expect(describeSignedMoney(0, "EUR")).toBe("even");
  });
});
