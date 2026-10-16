// Browser error reports. The app posts uncaught errors here (see
// src/diagnostics/reportErrors.ts) so they can be read in the Convex
// dashboard's `clientErrors` table, or with
// `npx convex run clientErrors:recent`. Reports are normalized again here
// (src/diagnostics/errorReport.ts keeps only allowlisted parts, never game
// data), a global token bucket bounds how fast they are accepted, a row cap
// bounds how much they can store, and rows unseen for 30 days are deleted daily.
import { HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import { v } from "convex/values";
import {
  errorFingerprint,
  normalizeErrorReport,
  type ErrorReport
} from "../src/diagnostics/errorReport";
import { components, internal } from "./_generated/api";
import { internalMutation, internalQuery, mutation, type MutationCtx } from "./_generated/server";

const errorReportLimiter = new RateLimiter(components.rateLimiter, {
  // A broken release can make every open tab report at once; 30 back-to-back
  // and 120 an hour after that is plenty to see it, while a scripted flood
  // costs at most a couple of writes a minute.
  clientErrorReport: { kind: "token bucket", rate: 120, period: HOUR, capacity: 30 }
});

/** Distinct errors kept at once; repeats of a stored error still count. */
export const MAX_CLIENT_ERROR_ROWS = 1000;
/** Rows whose error has not been seen for this long are deleted. */
export const CLIENT_ERROR_RETENTION_MS = 30 * 24 * HOUR;
export const CLIENT_ERROR_PRUNE_BATCH = 200;

const ROWS_COUNTER = "clientErrorRows";

async function rowsCounter(ctx: MutationCtx) {
  return await ctx.db
    .query("roomCounters")
    .withIndex("by_name", (index) => index.eq("name", ROWS_COUNTER))
    .unique();
}

const kindValidator = v.union(v.literal("error"), v.literal("rejection"), v.literal("render"));

export const report = mutation({
  args: {
    kind: kindValidator,
    message: v.string(),
    stack: v.optional(v.string()),
    path: v.string(),
    build: v.string(),
    userAgent: v.string()
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Reporting never fails the caller: over the limit or the cap, the report is dropped.
    const limit = await errorReportLimiter.limit(ctx, "clientErrorReport");
    if (!limit.ok) return null;
    const report: ErrorReport = normalizeErrorReport(args);
    const fingerprint = errorFingerprint(report);
    const now = Date.now();
    const existing = await ctx.db
      .query("clientErrors")
      .withIndex("by_fingerprint", (index) => index.eq("fingerprint", fingerprint))
      .unique();
    if (existing) {
      await ctx.db.patch("clientErrors", existing._id, {
        count: existing.count + 1,
        lastSeenAt: now,
        path: report.path,
        userAgent: report.userAgent
      });
      return null;
    }
    const counter = await rowsCounter(ctx);
    const rows = counter?.value ?? 0;
    if (rows >= MAX_CLIENT_ERROR_ROWS) return null;
    if (counter) {
      await ctx.db.patch("roomCounters", counter._id, { value: rows + 1 });
    } else {
      await ctx.db.insert("roomCounters", { name: ROWS_COUNTER, value: 1 });
    }
    await ctx.db.insert("clientErrors", { fingerprint, ...report, count: 1, firstSeenAt: now, lastSeenAt: now });
    return null;
  }
});

/** Deletes errors unseen for CLIENT_ERROR_RETENTION_MS, a batch at a time. */
export const prune = internalMutation({
  args: {},
  returns: v.object({ deleted: v.number(), continues: v.boolean() }),
  handler: async (ctx) => {
    const cutoff = Date.now() - CLIENT_ERROR_RETENTION_MS;
    const stale = await ctx.db
      .query("clientErrors")
      .withIndex("by_last_seen_at", (index) => index.lt("lastSeenAt", cutoff))
      .take(CLIENT_ERROR_PRUNE_BATCH);
    for (const row of stale) await ctx.db.delete("clientErrors", row._id);
    if (stale.length > 0) {
      const counter = await rowsCounter(ctx);
      if (counter) await ctx.db.patch("roomCounters", counter._id, { value: Math.max(0, counter.value - stale.length) });
    }
    const continues = stale.length === CLIENT_ERROR_PRUNE_BATCH;
    if (continues) await ctx.scheduler.runAfter(0, internal.clientErrors.prune, {});
    return { deleted: stale.length, continues };
  }
});

/** The most recently seen errors, newest first: `npx convex run clientErrors:recent`. */
export const recent = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(1, Math.floor(args.limit ?? 20)), 100);
    return await ctx.db.query("clientErrors").withIndex("by_last_seen_at").order("desc").take(limit);
  }
});
