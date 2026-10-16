import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettlementPanel } from "../components/SettlementPanel";
import {
  drawSettlementImage,
  settlementImageFileName,
  settlementImageHeight
} from "../components/settlementPanel/settlementImage";
import { buildSettlementImageModel } from "../domain/settlementImage";
import type { Player, PlayerLedgerSummary, SettlementPin } from "../domain/pokerTypes";

const players: Player[] = [
  { id: "a", name: "Alex", seatIndex: 0, isActive: true },
  { id: "b", name: "Blair", seatIndex: 1, isActive: true },
  { id: "c", name: "Casey", seatIndex: 2, isActive: true }
];

function summary(playerId: string, netCents: number): PlayerLedgerSummary {
  return {
    playerId,
    bankBuyInsCents: 0,
    bankCashOutsCents: 0,
    sentToPlayersCents: 0,
    receivedFromPlayersCents: 0,
    owedToPlayersCents: 0,
    owedByPlayersCents: 0,
    debtCoveredByOthersCents: 0,
    debtCoveredForOthersCents: 0,
    netCents
  };
}

const summaries = [summary("a", 2500), summary("b", -1500), summary("c", -1000)];
const pins: SettlementPin[] = [{ id: "pin_1", fromPlayerId: "c", toPlayerId: "a", amountCents: 1000, status: "paid" }];

describe("settlement image", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists payments still to make before paid ones, and results biggest win first", () => {
    const model = buildSettlementImageModel(" Friday night ", players, summaries, pins, {
      currencyCode: "EUR",
      locale: "en-US",
      date: new Date("2026-10-16T12:00:00Z")
    });
    expect(model).toEqual({
      title: "Friday night",
      payments: [
        { from: "Blair", to: "Alex", amount: "€15.00", paid: false },
        { from: "Casey", to: "Alex", amount: "€10.00", paid: true }
      ],
      results: [
        { name: "Alex", amount: "+€25.00", tone: "positive" },
        { name: "Casey", amount: "-€10.00", tone: "negative" },
        { name: "Blair", amount: "-€15.00", tone: "negative" }
      ],
      paymentsNote: null,
      footer: "Poker Tracker · Oct 16, 2026"
    });
    expect(buildSettlementImageModel("", players, [summary("a", 0)], []).paymentsNote).toBe("No payments between players needed.");
    expect(settlementImageHeight(model)).toBeGreaterThan(settlementImageHeight({ ...model, results: [] }));
  });

  it("names the file after the game", () => {
    expect(settlementImageFileName("Friday Night @ Alex's!")).toBe("friday-night-alexs-settlement.png");
    expect(settlementImageFileName("🃏")).toBe("poker-settlement.png");
  });

  /** A fake 2D context that measures 8px per character and records what is drawn where. */
  function fakeContext() {
    const drawn: Array<{ text: string; x: number; y: number }> = [];
    const measured: string[] = [];
    const context = new Proxy(
      {
        drawn,
        measured,
        measureText: (text: string) => {
          measured.push(text);
          return { width: Array.from(text).length * 8 };
        },
        fillText: (text: string, x: number, y: number) => {
          drawn.push({ text, x, y });
        }
      },
      { get: (target, key) => (key in target ? target[key as keyof typeof target] : () => undefined), set: () => true }
    );
    return context as unknown as CanvasRenderingContext2D & { drawn: typeof drawn; measured: string[] };
  }

  function mockCanvas(blob: Blob | null = new Blob(["png"], { type: "image/png" })) {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(fakeContext());
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(blob));
  }

  function mockDownload() {
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:image"), revokeObjectURL: vi.fn() });
    return vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  }

  it("draws payer, arrow, and recipient left to right, so right-to-left names keep their side", () => {
    const context = fakeContext();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);
    const rtl: Player[] = [
      { id: "a", name: "أحمد", seatIndex: 0, isActive: true },
      { id: "b", name: "محمود", seatIndex: 1, isActive: true }
    ];
    const model = buildSettlementImageModel("Night", rtl, [summary("a", 500), summary("b", -500)], []);
    expect(drawSettlementImage(model, document.createElement("canvas"))).toBe(true);
    const row = context.drawn.filter((entry) => ["محمود", "  →  ", "أحمد"].includes(entry.text));
    expect(row.map((entry) => entry.text).slice(0, 3)).toEqual(["محمود", "  →  ", "أحمد"]);
    expect(row[0].x).toBeLessThan(row[1].x);
    expect(row[1].x).toBeLessThan(row[2].x);
  });

  it("shortens each long name on its own, keeping the recipient, the paid badge, and the speed", () => {
    const context = fakeContext();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);
    const long: Player[] = [
      { id: "a", name: "W".repeat(10_000), seatIndex: 0, isActive: true },
      { id: "b", name: "Christopher Montgomery-Wellington", seatIndex: 1, isActive: true }
    ];
    const paid: SettlementPin[] = [{ id: "pin_1", fromPlayerId: "b", toPlayerId: "a", amountCents: 500, status: "paid" }];
    const model = buildSettlementImageModel("Night", long, [summary("a", 500), summary("b", -500)], paid);
    const started = performance.now();
    drawSettlementImage(model, document.createElement("canvas"));
    expect(performance.now() - started).toBeLessThan(100);
    const texts = context.drawn.map((entry) => entry.text);
    // Nothing longer than the fitting cap is ever measured.
    expect(context.measured.length).toBeGreaterThan(0);
    expect(Math.max(...context.measured.map((text) => text.length))).toBeLessThanOrEqual(641);
    expect(texts).toContain("PAID");
    expect(texts.some((text) => text.startsWith("W") && text.endsWith("…") && text.length < 80)).toBe(true);
    expect(texts.some((text) => text.startsWith("Christopher"))).toBe(true);
  });

  function renderPanel() {
    render(
      <SettlementPanel
        bankSummary={{ issuedCents: 0, returnedCents: 0, inPlayCents: 0 } as never}
        gameName="Friday"
        imbalanceCents={0}
        players={players}
        readOnly={false}
        settlementReady
        summaries={summaries}
        settlementPins={pins}
        onAddTransaction={() => true}
      />
    );
  }

  it("hands the picture to the share sheet where files can be shared", async () => {
    mockCanvas();
    const share = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { canShare: () => true, share });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Share image" }));
    await waitFor(() => expect(share).toHaveBeenCalledOnce());
    const [{ files, title }] = share.mock.calls[0] as unknown as [{ files: File[]; title: string }];
    expect(files[0].name).toBe("friday-settlement.png");
    expect(files[0].type).toBe("image/png");
    expect(title).toBe("Friday settlement");
    expect(await screen.findByRole("button", { name: "Shared" })).toBeInTheDocument();
    Object.assign(navigator, { canShare: undefined, share: undefined });
  });

  it("downloads the picture where files cannot be shared, or when sharing is refused", async () => {
    mockCanvas();
    const click = mockDownload();
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Share image" }));
    expect(await screen.findByRole("button", { name: "Image saved" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Settlement image saved.");
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe("friday-settlement.png");

    Object.assign(navigator, { canShare: () => true, share: vi.fn(() => Promise.reject(new DOMException("No", "NotAllowedError"))) });
    fireEvent.click(await screen.findByRole("button", { name: "Share image" }, { timeout: 3000 }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(2));
    Object.assign(navigator, { canShare: undefined, share: undefined });
  });

  it("does nothing more when the share sheet is closed", async () => {
    mockCanvas();
    const click = mockDownload();
    Object.assign(navigator, { canShare: () => true, share: vi.fn(() => Promise.reject(new DOMException("Closed", "AbortError"))) });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Share image" }));
    await waitFor(() => expect(navigator.share).toHaveBeenCalled());
    expect(await screen.findByRole("button", { name: "Share image" })).toBeEnabled();
    expect(click).not.toHaveBeenCalled();
    Object.assign(navigator, { canShare: undefined, share: undefined });
  });

  it("says so when the browser cannot draw or encode it", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Share image" }));
    expect(await screen.findByRole("button", { name: "Image unavailable" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("This browser cannot make the settlement image.");

    vi.restoreAllMocks();
    mockCanvas(null);
    fireEvent.click(screen.getByRole("button", { name: "Image unavailable" }));
    expect(await screen.findByRole("button", { name: "Image unavailable" })).toBeInTheDocument();
  });
});
