/**
 * Draws the settlement picture (domain/settlementImage.ts) on a canvas and
 * hands it to the system share sheet, or downloads it where sharing files is
 * not supported. Everything happens on the device.
 */
import type { SettlementImageModel, SettlementImageTone } from "../../domain/settlementImage";

const SCALE = 2;
const WIDTH = 540;
const PADDING = 28;
const ROW = 34;
const COLORS = {
  background: "#ffffff",
  ink: "#16201d",
  muted: "#64716c",
  line: "#d8e0dc",
  positive: "#146c43",
  negative: "#b42318",
  neutral: "#16201d",
  paidBackground: "#eef3f1"
} satisfies Record<string, string> & Record<SettlementImageTone, string>;
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** Names longer than this many characters are cut before measuring, so fitting stays cheap. */
const MAX_FIT_CHARACTERS = 80;

/** User-perceived characters, so cutting never splits an emoji or accent. */
type GraphemeSegmenter = { segment(text: string): Iterable<{ segment: string }> };
const Segmenter = (Intl as unknown as {
  Segmenter?: new (locale: undefined, options: { granularity: "grapheme" }) => GraphemeSegmenter;
}).Segmenter;

function characters(text: string): string[] {
  if (Segmenter) return Array.from(new Segmenter(undefined, { granularity: "grapheme" }).segment(text), (part) => part.segment);
  return Array.from(text);
}

/** The text, or as much of it as fits in `width` followed by "…" (binary search over characters). */
function fit(context: CanvasRenderingContext2D, text: string, width: number): string {
  const all = characters(text.slice(0, MAX_FIT_CHARACTERS * 8));
  const parts = all.slice(0, MAX_FIT_CHARACTERS);
  const whole = parts.join("");
  if (parts.length === all.length && whole.length === text.length && context.measureText(whole).width <= width) return whole;
  let low = 0;
  let high = parts.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (context.measureText(`${parts.slice(0, middle).join("")}…`).width <= width) low = middle;
    else high = middle - 1;
  }
  return `${parts.slice(0, Math.max(low, 1)).join("")}…`;
}

export function settlementImageHeight(model: SettlementImageModel): number {
  const paymentRows = model.payments.length || 1;
  return PADDING * 2 + 44 + 24 + 30 + paymentRows * ROW + 24 + 30 + model.results.length * ROW + 24 + 20;
}

/** Draws the picture onto `canvas`, sizing it; false when the browser has no 2D canvas. */
export function drawSettlementImage(model: SettlementImageModel, canvas: HTMLCanvasElement): boolean {
  const height = settlementImageHeight(model);
  canvas.width = WIDTH * SCALE;
  canvas.height = height * SCALE;
  const context = canvas.getContext("2d");
  if (!context) return false;
  context.scale(SCALE, SCALE);
  context.fillStyle = COLORS.background;
  context.fillRect(0, 0, WIDTH, height);
  context.textBaseline = "middle";
  const inner = WIDTH - PADDING * 2;
  let y = PADDING;

  context.fillStyle = COLORS.ink;
  context.font = `800 26px ${FONT}`;
  context.textAlign = "left";
  context.fillText(fit(context, model.title, inner), PADDING, y + 16);
  y += 44 + 24;

  const heading = (text: string) => {
    context.fillStyle = COLORS.muted;
    context.font = `800 13px ${FONT}`;
    context.textAlign = "left";
    context.fillText(text.toUpperCase(), PADDING, y + 10);
    y += 30;
  };
  const divider = () => {
    context.strokeStyle = COLORS.line;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(PADDING, y + ROW - 0.5);
    context.lineTo(WIDTH - PADDING, y + ROW - 0.5);
    context.stroke();
    y += ROW;
  };
  /** Draws an amount at the right edge; returns the width it took. */
  const amount = (text: string, color: string) => {
    context.font = `800 16px ${FONT}`;
    context.fillStyle = color;
    context.textAlign = "right";
    context.fillText(text, WIDTH - PADDING, y + ROW / 2);
    return context.measureText(text).width;
  };
  const row = (left: string, right: string, color: string, muted = false) => {
    const amountWidth = amount(right, color);
    context.font = `700 16px ${FONT}`;
    context.fillStyle = muted ? COLORS.muted : COLORS.ink;
    context.textAlign = "left";
    context.fillText(fit(context, left, inner - amountWidth - 24), PADDING, y + ROW / 2);
    divider();
  };
  /**
   * One payment: payer, arrow, recipient, an optional "paid" badge, and the
   * amount. Each part is drawn on its own, left to right, so a right-to-left
   * name can never swap which side of the arrow it appears on, and each name
   * is shortened on its own so the recipient and badge always show.
   */
  const paymentRow = (payment: SettlementImageModel["payments"][number]) => {
    if (payment.paid) {
      context.fillStyle = COLORS.paidBackground;
      context.fillRect(PADDING - 8, y + 2, inner + 16, ROW - 4);
    }
    const amountWidth = amount(payment.amount, payment.paid ? COLORS.muted : COLORS.ink);
    context.font = `800 11px ${FONT}`;
    const badge = payment.paid ? "PAID" : "";
    const badgeWidth = badge ? context.measureText(badge).width + 16 : 0;
    context.font = `700 16px ${FONT}`;
    const arrow = "  →  ";
    const arrowWidth = context.measureText(arrow).width;
    const nameSpace = inner - amountWidth - badgeWidth - arrowWidth - 24;
    // Capped like fit's input, so a pasted wall of text costs no more to lay out than to draw.
    const fromWidth = context.measureText(payment.from.slice(0, MAX_FIT_CHARACTERS * 8)).width;
    const toWidth = context.measureText(payment.to.slice(0, MAX_FIT_CHARACTERS * 8)).width;
    // Each name keeps what it needs when it fits in half; a longer one takes what the other leaves.
    const half = nameSpace / 2;
    const fromSpace = toWidth <= half ? nameSpace - toWidth : fromWidth <= half ? fromWidth : half;
    const from = fit(context, payment.from, fromSpace);
    const to = fit(context, payment.to, nameSpace - context.measureText(from).width);
    context.fillStyle = payment.paid ? COLORS.muted : COLORS.ink;
    context.textAlign = "left";
    context.direction = "ltr";
    let x = PADDING;
    for (const part of [from, arrow, to]) {
      context.fillText(part, x, y + ROW / 2);
      x += context.measureText(part).width;
    }
    if (badge) {
      context.font = `800 11px ${FONT}`;
      context.fillStyle = COLORS.positive;
      context.fillText(badge, x + 10, y + ROW / 2);
    }
    divider();
  };

  heading("Payments");
  if (model.payments.length === 0) row(model.paymentsNote ?? "", "", COLORS.muted, true);
  for (const payment of model.payments) paymentRow(payment);
  y += 24;
  heading("Results");
  for (const result of model.results) row(result.name, result.amount, COLORS[result.tone]);
  y += 24;

  context.fillStyle = COLORS.muted;
  context.font = `600 12px ${FONT}`;
  context.textAlign = "left";
  context.fillText(model.footer, PADDING, y + 6);
  return true;
}

export type ShareImageResult = "shared" | "downloaded" | "cancelled" | "failed";

/** A file name from the game name, e.g. "friday-night-settlement.png". */
export function settlementImageFileName(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "-")
    .slice(0, 40);
  return `${slug || "poker"}-settlement.png`;
}

/** Shares the picture through the system share sheet, or downloads it where files cannot be shared. */
export async function shareSettlementImage(model: SettlementImageModel): Promise<ShareImageResult> {
  const canvas = document.createElement("canvas");
  if (!drawSettlementImage(model, canvas)) return "failed";
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) return "failed";
  const name = settlementImageFileName(model.title);
  const file = new File([blob], name, { type: "image/png" });
  if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: `${model.title} settlement` });
      return "shared";
    } catch (error) {
      // Closing the share sheet is not a failure.
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
    }
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return "downloaded";
}
