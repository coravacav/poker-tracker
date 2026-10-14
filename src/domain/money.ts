/**
 * Money is stored as integer minor units ("cents") everywhere. Every currency
 * a game can use has exactly two minor digits, so the cents math never changes
 * with the currency; the code only affects how amounts are labeled.
 */
export const SUPPORTED_CURRENCY_CODES = [
  "USD",
  "EUR",
  "GBP",
  "CAD",
  "AUD",
  "NZD",
  "CHF",
  "SEK",
  "NOK",
  "DKK",
  "MXN",
  "BRL",
  "INR",
  "SGD",
  "HKD",
  "ZAR",
  "PLN"
] as const;

export type CurrencyCode = (typeof SUPPORTED_CURRENCY_CODES)[number];

export const DEFAULT_CURRENCY_CODE: CurrencyCode = "USD";

/** English names for the currency picker (static so labels don't depend on Intl.DisplayNames support). */
export const CURRENCY_NAMES: Readonly<Record<CurrencyCode, string>> = {
  USD: "US dollar",
  EUR: "Euro",
  GBP: "British pound",
  CAD: "Canadian dollar",
  AUD: "Australian dollar",
  NZD: "New Zealand dollar",
  CHF: "Swiss franc",
  SEK: "Swedish krona",
  NOK: "Norwegian krone",
  DKK: "Danish krone",
  MXN: "Mexican peso",
  BRL: "Brazilian real",
  INR: "Indian rupee",
  SGD: "Singapore dollar",
  HKD: "Hong Kong dollar",
  ZAR: "South African rand",
  PLN: "Polish złoty"
};

const SUPPORTED_CURRENCY_SET: ReadonlySet<string> = new Set(SUPPORTED_CURRENCY_CODES);

export function isSupportedCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === "string" && SUPPORTED_CURRENCY_SET.has(value);
}

/** The code itself when supported, otherwise USD. For display paths only; storage validates instead. */
export function toCurrencyCode(value: unknown): CurrencyCode {
  return isSupportedCurrencyCode(value) ? value : DEFAULT_CURRENCY_CODE;
}

// --- Parsing ---------------------------------------------------------------

/** One leading or trailing symbol is accepted and ignored; the game's currency decides what it means. */
const LEADING_SYMBOL = /^[$€£₹]\s*/;
const TRAILING_SYMBOL = /\s*[$€£₹]$/;
const GROUP_SEPARATOR = /[ \u00a0\u202f'’]/g;

/**
 * Number shapes accepted, each mapped to "digits[.digits]":
 * - plain, dot decimal: 20, 20.5, 20.50, .25
 * - plain, comma decimal: 20,5, 20,50, ,25 (one comma followed by one or two digits)
 * - comma thousands, dot decimal: 1,234 / 1,234.50 / 1,234,567.89
 * - Indian grouping, dot decimal: 1,23,456.50
 * - dot thousands, comma decimal: 1.234,50 (the decimal part is required, so 1.234 stays invalid)
 * - space or apostrophe thousands, either decimal: 1 234,50 / 1'234.50
 * Anything else (mixed or misplaced separators, three decimals) is rejected.
 */
function normalizeNumber(text: string): string | null {
  if (/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(text)) return text;
  if (/^\d*,\d{1,2}$/.test(text)) return text.replace(",", ".");
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d{0,2})?$/.test(text)) return text.replace(/,/g, "");
  if (/^\d{1,2}(?:,\d{2})+,\d{3}(?:\.\d{0,2})?$/.test(text)) return text.replace(/,/g, "");
  if (/^\d{1,3}(?:\.\d{3})+,\d{1,2}$/.test(text)) return text.replace(/\./g, "").replace(",", ".");
  if (/^\d{1,3}(?:[ \u00a0\u202f'’]\d{3})+(?:[.,]\d{1,2})?$/.test(text)) {
    return text.replace(GROUP_SEPARATOR, "").replace(",", ".");
  }
  return null;
}

export function parseMoneyToCents(rawValue: string): number | null {
  let text = rawValue.trim();
  if (LEADING_SYMBOL.test(text)) {
    text = text.replace(LEADING_SYMBOL, "");
  } else {
    text = text.replace(TRAILING_SYMBOL, "");
  }

  if (!text || text.startsWith("-")) {
    return null;
  }

  const normalized = normalizeNumber(text);
  if (normalized === null) {
    return null;
  }

  const [wholeRaw, decimalRaw = ""] = normalized.split(".");
  const whole = Number.parseInt(wholeRaw || "0", 10);
  const decimal = Number.parseInt(decimalRaw.padEnd(2, "0"), 10);

  if (!Number.isFinite(whole) || !Number.isFinite(decimal)) {
    return null;
  }

  return whole * 100 + decimal;
}

// --- Formatting ------------------------------------------------------------

/** The user's locale for number formatting; en-US when there is no browser. */
export function defaultFormatLocale(): string {
  const language = typeof navigator === "undefined" ? undefined : navigator.language;
  return typeof language === "string" && language ? language : "en-US";
}

export type FormatCurrencyOptions = {
  /** BCP 47 locale; defaults to the user's (navigator.language). */
  locale?: string;
  /** Drop ",00"/".00" for whole amounts, e.g. "$20" on quick-amount buttons. */
  trimWholeCents?: boolean;
};

const formatterCache = new Map<string, Intl.NumberFormat>();

function currencyFormatter(locale: string, currencyCode: string, trim: boolean): Intl.NumberFormat {
  const key = `${locale}|${currencyCode}|${trim ? 0 : 2}`;
  let formatter = formatterCache.get(key);
  if (!formatter) {
    const options: Intl.NumberFormatOptions = {
      style: "currency",
      currency: currencyCode,
      ...(trim ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : {})
    };
    try {
      formatter = new Intl.NumberFormat(locale, options);
    } catch {
      // An unusable locale string; currencies are checked before this.
      formatter = new Intl.NumberFormat("en-US", options);
    }
    formatterCache.set(key, formatter);
  }
  return formatter;
}

/**
 * Formats integer cents in the game's currency for the user's locale.
 * Codes outside the supported set never throw; they fall back to "12.50 XYZ".
 */
export function formatCurrency(
  cents: number,
  currencyCode: string = DEFAULT_CURRENCY_CODE,
  { locale = defaultFormatLocale(), trimWholeCents = false }: FormatCurrencyOptions = {}
): string {
  if (!isSupportedCurrencyCode(currencyCode)) {
    return formatPlainCurrency(cents, currencyCode);
  }
  return currencyFormatter(locale, currencyCode, trimWholeCents && cents % 100 === 0).format(cents / 100);
}

/**
 * Locale-independent text without Intl, for server-side audit summaries:
 * "$12.50" for US dollars (as before), otherwise "12.50 EUR".
 */
export function formatPlainCurrency(cents: number, currencyCode: string = DEFAULT_CURRENCY_CODE): string {
  const safe = Number.isFinite(cents) ? Math.trunc(cents) : 0;
  const sign = safe < 0 ? "-" : "";
  const absolute = Math.abs(safe);
  const amount = `${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
  if (currencyCode === "USD") return `${sign}$${amount}`;
  const code = /^[A-Za-z]{3}$/.test(currencyCode) ? currencyCode.toUpperCase() : "";
  return `${sign}${amount}${code ? ` ${code}` : ""}`;
}

export function centsToInputValue(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function describeSignedMoney(
  cents: number,
  currencyCode: string = DEFAULT_CURRENCY_CODE,
  options: FormatCurrencyOptions = {}
): string {
  if (cents > 0) {
    return `owed ${formatCurrency(cents, currencyCode, options)}`;
  }

  if (cents < 0) {
    return `owes ${formatCurrency(Math.abs(cents), currencyCode, options)}`;
  }

  return "even";
}
