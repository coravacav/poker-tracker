/**
 * Venmo usernames and pay links for settlement payments. Pure.
 *
 * Venmo usernames are 5–30 characters of letters, digits, hyphens, and
 * underscores (help.venmo.com, "Check or Edit Your Username"). Input is
 * accepted leniently (a leading @, surrounding spaces, or a pasted
 * venmo.com profile link) but only the bare username is stored.
 *
 * Pay links use Venmo's documented web form
 * `https://venmo.com/<username>?txn=pay&amount=<dollars>&note=<text>`,
 * which works in desktop browsers and opens the Venmo app on phones.
 * Venmo only moves US dollars, so links are offered for USD games only.
 */

export const VENMO_HANDLE_MIN_LENGTH = 5;
export const VENMO_HANDLE_MAX_LENGTH = 30;
const VENMO_HANDLE_PATTERN = /^[A-Za-z0-9_-]{5,30}$/;
const VENMO_PROFILE_URL_PATTERN =
  /^(?:https?:\/\/)?(?:www\.|account\.)?venmo\.com\/(?:u\/)?([^/?#\s]+)\/?(?:[?#].*)?$/i;
const MAX_VENMO_NOTE_LENGTH = 120;

/** A stored, already-normalized username. */
export function isValidVenmoHandle(value: unknown): value is string {
  return typeof value === "string" && VENMO_HANDLE_PATTERN.test(value);
}

/**
 * The bare username for what someone typed or pasted, or null when it is not
 * a Venmo username. Blank input is also null; callers treat it as "none".
 */
export function normalizeVenmoHandle(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let text = input.trim();
  const profile = VENMO_PROFILE_URL_PATTERN.exec(text);
  if (profile) text = profile[1];
  text = text.replace(/^@/, "");
  return isValidVenmoHandle(text) ? text : null;
}

/** A message for input that is neither blank nor a Venmo username. */
export function venmoHandleError(input: string): string | null {
  if (!input.trim() || normalizeVenmoHandle(input)) return null;
  return `Venmo usernames are ${VENMO_HANDLE_MIN_LENGTH}–${VENMO_HANDLE_MAX_LENGTH} letters, numbers, hyphens, or underscores.`;
}

/** Venmo only sends US dollars. */
export function venmoSupportsCurrency(currencyCode: string): boolean {
  return currencyCode === "USD";
}

/** Plain decimal dollars, e.g. 1250 -> "12.50". */
export function formatVenmoAmount(amountCents: number): string {
  const dollars = Math.floor(amountCents / 100);
  const cents = amountCents % 100;
  return `${dollars}.${String(cents).padStart(2, "0")}`;
}

/** The payment note, e.g. "Friday Game poker settlement". */
export function venmoSettlementNote(gameName: string): string {
  const name = gameName.trim().replace(/\s+/g, " ") || "Poker Night";
  const note = /poker/i.test(name) ? `${name} settlement` : `${name} poker settlement`;
  return note.slice(0, MAX_VENMO_NOTE_LENGTH);
}

/**
 * A link that opens a prefilled Venmo payment to `handle`, or null when the
 * username or amount cannot be used.
 */
export function buildVenmoPayUrl({
  handle,
  amountCents,
  note
}: {
  handle: string | undefined;
  amountCents: number;
  note: string;
}): string | null {
  if (!isValidVenmoHandle(handle) || !Number.isSafeInteger(amountCents) || amountCents <= 0) {
    return null;
  }
  const params = new URLSearchParams({
    txn: "pay",
    amount: formatVenmoAmount(amountCents),
    note
  });
  return `https://venmo.com/${encodeURIComponent(handle)}?${params.toString()}`;
}
