// @vitest-environment edge-runtime
/// <reference types="vite/client" />

import rateLimiterTest from "@convex-dev/rate-limiter/test";
import presenceTest from "@convex-dev/presence/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { CLIENT_ERROR_PRUNE_BATCH, CLIENT_ERROR_RETENTION_MS, MAX_CLIENT_ERROR_ROWS } from "./clientErrors";
import schema from "./schema";

const modules = import.meta.glob("./**/!(*.*.*)*.*s");

function setup() {
  const test = convexTest(schema, modules);
  presenceTest.register(test);
  rateLimiterTest.register(test);
  return test;
}

const base = {
  kind: "error" as const,
  message: "TypeError: Cannot read properties of undefined (reading 'name')",
  stack: "    at Seat (https://poker.example/assets/index-DKCiE8wL.js:12:345)",
  path: "/",
  build: "abc123f",
  userAgent: "Mozilla/5.0 Test"
};

async function rows(test: ReturnType<typeof setup>) {
  return await test.run(async (ctx) => await ctx.db.query("clientErrors").take(2000));
}

async function rowCounter(test: ReturnType<typeof setup>) {
  return await test.run(async (ctx) =>
    (await ctx.db.query("roomCounters").withIndex("by_name", (index) => index.eq("name", "clientErrorRows")).unique())?.value ?? 0
  );
}

describe("client error reports", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-16T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stores one row per distinct error and counts repeats", async () => {
    const test = setup();
    await test.mutation(api.clientErrors.report, base);
    vi.advanceTimersByTime(60_000);
    await test.mutation(api.clientErrors.report, { ...base, path: "/later", userAgent: "Other" });
    await test.mutation(api.clientErrors.report, { ...base, message: "RangeError: Invalid time value" });
    const stored = await rows(test);
    expect(stored).toHaveLength(2);
    const repeated = stored.find((row) => row.message.startsWith("TypeError"))!;
    expect(repeated).toMatchObject({ count: 2, path: "<other>", userAgent: "Other · Other", kind: "error", build: "abc123f" });
    expect(repeated.lastSeenAt - repeated.firstSeenAt).toBe(60_000);
    expect(await rowCounter(test)).toBe(2);
  });

  it("normalizes what clients send instead of trusting it", async () => {
    const test = setup();
    const secret = "Zq3xT0aBcDeFgHiJkLmNoPqRsTuV";
    await test.mutation(api.clientErrors.report, {
      ...base,
      message: `Error: Alex owes Blair 125.50 https://poker.example/#invite=${secret}`,
      path: `/join#invite=${secret}`,
      stack: `    at f (https://poker.example/#invite=${secret}:1:1)\n    at g (https://poker.example/assets/${"x".repeat(1_000_000)}:2:2)`,
      userAgent: `Alex's phone ${secret}`
    });
    const [row] = await rows(test);
    expect(row).toMatchObject({
      message: "Error (message withheld)",
      path: "<other>",
      userAgent: "Other · Other"
    });
    // The second frame was cut mid-line by the length limit, so the stack is not trusted at all.
    expect(row.stack).toBeUndefined();
    expect(JSON.stringify(row)).not.toMatch(/Alex|Blair|125|Zq3x/);
  });

  it("drops reports over the rate limit or the row cap without failing", async () => {
    const test = setup();
    // Distinct errors (by stack position), more than the bucket holds.
    for (let index = 0; index < 40; index += 1) {
      await test.mutation(api.clientErrors.report, {
        ...base,
        stack: `    at f (https://poker.example/assets/index-DKCiE8wL.js:${index + 1}:1)`
      });
    }
    // The bucket holds 30 reports.
    expect(await rows(test)).toHaveLength(30);

    const capped = setup();
    await capped.run(async (ctx) => {
      await ctx.db.insert("roomCounters", { name: "clientErrorRows", value: MAX_CLIENT_ERROR_ROWS });
    });
    await capped.mutation(api.clientErrors.report, base);
    expect(await rows(capped)).toHaveLength(0);
  });

  it("deletes errors unseen for the retention period, in batches", async () => {
    const test = setup();
    const now = Date.now();
    await test.run(async (ctx) => {
      for (let index = 0; index < CLIENT_ERROR_PRUNE_BATCH + 5; index += 1) {
        await ctx.db.insert("clientErrors", {
          fingerprint: `old_${index}`,
          ...base,
          count: 1,
          firstSeenAt: now - CLIENT_ERROR_RETENTION_MS - 1000,
          lastSeenAt: now - CLIENT_ERROR_RETENTION_MS - 1000
        });
      }
      await ctx.db.insert("clientErrors", { fingerprint: "recent", ...base, count: 1, firstSeenAt: now, lastSeenAt: now });
      await ctx.db.insert("roomCounters", { name: "clientErrorRows", value: CLIENT_ERROR_PRUNE_BATCH + 6 });
    });
    const first = await test.mutation(internal.clientErrors.prune, {});
    expect(first).toEqual({ deleted: CLIENT_ERROR_PRUNE_BATCH, continues: true });
    await test.finishAllScheduledFunctions(vi.runAllTimers);
    const left = await rows(test);
    expect(left.map((row) => row.fingerprint)).toEqual(["recent"]);
    expect(await rowCounter(test)).toBe(1);

    const recent = await test.query(internal.clientErrors.recent, {});
    expect(recent.map((row) => row.fingerprint)).toEqual(["recent"]);
  });
});
