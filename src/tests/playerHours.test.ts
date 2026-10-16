import { describe, expect, it } from "vitest";
import {
  formatDuration,
  hourlyResult,
  MAX_SESSION_MS,
  MIN_SESSION_MS,
  playerSessionMs
} from "../domain/playerHours";
import type { Transaction } from "../domain/pokerTypes";

const START = Date.parse("2026-10-14T19:00:00.000Z");
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const at = (ms: number) => new Date(START + ms).toISOString();

function buyIn(id: string, playerId: string, ms: number, extra: Partial<Transaction> = {}): Transaction {
  return { id, type: "bank_buy_in", toPlayerId: playerId, amountCents: 2000, createdAt: at(ms), ...extra };
}

function cashOut(id: string, playerId: string, ms: number, extra: Partial<Transaction> = {}): Transaction {
  return { id, type: "bank_cash_out", fromPlayerId: playerId, amountCents: 3000, cashOutKind: "final", createdAt: at(ms), ...extra };
}

describe("player session length", () => {
  it("runs from the first buy-in to the last cash-out", () => {
    const transactions = [
      buyIn("t1", "alex", 0),
      buyIn("t2", "alex", HOUR),
      cashOut("t3", "alex", 2 * HOUR, { cashOutKind: "partial" }),
      cashOut("t4", "alex", 3 * HOUR + 20 * MINUTE),
      buyIn("t5", "blair", 30 * MINUTE)
    ];
    expect(playerSessionMs({ transactions }, "alex")).toBe(3 * HOUR + 20 * MINUTE);
    // No cash-out: the game cannot tell when Blair left.
    expect(playerSessionMs({ transactions }, "blair")).toBeNull();
    expect(playerSessionMs({ transactions }, "casey")).toBeNull();
  });

  it("ignores voided entries", () => {
    const transactions = [
      buyIn("t1", "alex", HOUR),
      // Both would widen the span if they counted.
      buyIn("t2", "alex", 0, { voidedAt: at(HOUR) }),
      cashOut("t3", "alex", 3 * HOUR),
      cashOut("t4", "alex", 5 * HOUR, { voidedAt: at(5 * HOUR) })
    ];
    expect(playerSessionMs({ transactions }, "alex")).toBe(2 * HOUR);
  });

  it("dates a correction by the cash-out it corrects", () => {
    const transactions = [
      buyIn("t1", "alex", 0),
      cashOut("t2", "alex", 2 * HOUR, { voidedAt: at(14 * HOUR) }),
      // A recount entered the next morning stands for the 2-hour cash-out.
      cashOut("t3", "alex", 14 * HOUR, { correctsTransactionId: "t2" })
    ];
    expect(playerSessionMs({ transactions }, "alex")).toBe(2 * HOUR);
  });

  it("dates a flipped entry by the entry it flips", () => {
    const transactions = [
      buyIn("t1", "alex", 0),
      // Recorded at 4 h as a buy-in by mistake, flipped to a cash-out at 6 h: Alex left at 4 h.
      buyIn("t2", "alex", 4 * HOUR, { voidedAt: at(6 * HOUR) }),
      cashOut("t3", "alex", 6 * HOUR, { flippedFromTransactionId: "t2" })
    ];
    expect(playerSessionMs({ transactions }, "alex")).toBe(4 * HOUR);
    // Flipped the other way, a cash-out recorded at 30 min stands as a buy-in from then.
    const reversed = [
      cashOut("t1", "blair", 30 * 60 * 1000, { voidedAt: at(5 * HOUR) }),
      buyIn("t2", "blair", 5 * HOUR, { flippedFromTransactionId: "t1" }),
      cashOut("t3", "blair", 3 * HOUR)
    ];
    expect(playerSessionMs({ transactions: reversed }, "blair")).toBe(2.5 * HOUR);
  });

  it("treats games typed in at once, or left open past a day, as unknown", () => {
    const quick = [buyIn("t1", "alex", 0), cashOut("t2", "alex", MIN_SESSION_MS - 1)];
    expect(playerSessionMs({ transactions: quick }, "alex")).toBeNull();
    const long = [buyIn("t1", "alex", 0), cashOut("t2", "alex", MAX_SESSION_MS + 1)];
    expect(playerSessionMs({ transactions: long }, "alex")).toBeNull();
    const unreadable = [buyIn("t1", "alex", 0, { createdAt: "not a date" }), cashOut("t2", "alex", 2 * HOUR)];
    expect(playerSessionMs({ transactions: unreadable }, "alex")).toBeNull();
  });

  it("survives a correction cycle", () => {
    const transactions = [
      buyIn("t1", "alex", 0),
      cashOut("t2", "alex", 2 * HOUR, { correctsTransactionId: "t3" }),
      cashOut("t3", "alex", 3 * HOUR, { correctsTransactionId: "t2" })
    ];
    expect(playerSessionMs({ transactions }, "alex")).toBe(3 * HOUR);
  });
});

describe("hourly results", () => {
  it("divides timed games' results by their hours and skips untimed games", () => {
    expect(
      hourlyResult([
        { netCents: 3000, durationMs: 2 * HOUR },
        { netCents: -1000, durationMs: 2 * HOUR },
        { netCents: 99_999, durationMs: null }
      ])
    ).toEqual({ timedGames: 2, timedMs: 4 * HOUR, perHourCents: 500 });
    expect(hourlyResult([{ netCents: 100, durationMs: null }])).toEqual({ timedGames: 0, timedMs: 0, perHourCents: null });
    expect(hourlyResult([{ netCents: -1000, durationMs: 3 * HOUR }]).perHourCents).toBe(-333);
    // A one-cent loss over three hours rounds to zero, not -0 ("-$0.00").
    expect(Object.is(hourlyResult([{ netCents: -1, durationMs: 3 * HOUR }]).perHourCents, 0)).toBe(true);
  });

  it("formats lengths to the nearest five minutes", () => {
    expect(formatDuration(42 * MINUTE)).toBe("40 min");
    expect(formatDuration(3 * HOUR)).toBe("3 h");
    expect(formatDuration(3 * HOUR + 18 * MINUTE)).toBe("3 h 20 min");
    expect(formatDuration(MINUTE)).toBe("5 min");
  });
});
