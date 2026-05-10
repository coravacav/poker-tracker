const MONEY_PATTERN = /^\$?\s*([0-9]{1,9})(?:,?([0-9]{3}))*?(?:\.(\d{0,2}))?$/;

export function parseMoneyToCents(rawValue: string): number | null {
  const normalized = rawValue.trim().replace(/,/g, "");

  if (!normalized || normalized.startsWith("-")) {
    return null;
  }

  const match = normalized.match(MONEY_PATTERN);
  if (!match) {
    return null;
  }

  const withoutSymbol = normalized.replace(/^\$\s*/, "");
  const [wholeRaw, decimalRaw = ""] = withoutSymbol.split(".");
  const whole = Number.parseInt(wholeRaw, 10);
  const decimal = Number.parseInt(decimalRaw.padEnd(2, "0"), 10);

  if (!Number.isFinite(whole) || !Number.isFinite(decimal)) {
    return null;
  }

  return whole * 100 + decimal;
}

export function formatCurrency(cents: number, currencyCode: "USD" = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode
  }).format(cents / 100);
}

export function centsToInputValue(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function describeSignedMoney(cents: number): string {
  if (cents > 0) {
    return `owed ${formatCurrency(cents)}`;
  }

  if (cents < 0) {
    return `owes ${formatCurrency(Math.abs(cents))}`;
  }

  return "even";
}
