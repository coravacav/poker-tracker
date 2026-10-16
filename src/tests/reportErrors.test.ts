import { describe, expect, it, vi } from "vitest";
import { errorFingerprint, normalizeErrorReport, summarizeUserAgent, type ErrorReport } from "../diagnostics/errorReport";
import { createErrorReporter, MAX_REPORTS_PER_PAGE } from "../diagnostics/reportErrors";

const CHROME_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
const SAFARI_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

const report: ErrorReport = {
  kind: "error",
  message: "TypeError: Cannot read properties of undefined (reading 'name')",
  // Frames only: the reporter cuts the "Name: message" header off before normalizing.
  stack: [
    "    at Seat (https://poker.example/assets/index-DKCiE8wL.js:12:345)",
    "    at https://poker.example/assets/PlayMode-sjBlJKQa.js:3:20"
  ].join("\n"),
  path: "/",
  build: "abc123f",
  userAgent: CHROME_ANDROID
};

describe("error report normalization", () => {
  it("stores known engine wordings as fixed summaries and stack positions in the app's scripts", () => {
    const normalized = normalizeErrorReport(report);
    expect(normalized).toEqual({
      kind: "error",
      message: "TypeError: Cannot read properties of undefined",
      stack: "at /assets/index-DKCiE8wL.js:12:345\nat /assets/PlayMode-sjBlJKQa.js:3:20",
      path: "/",
      build: "abc123f",
      userAgent: "Chrome 140 · Android"
    });
    expect(normalizeErrorReport(normalized)).toEqual(normalized);
    const message = (text: string) => normalizeErrorReport({ ...report, message: text }).message;
    const cases: Array<[string, string]> = [
      ["TypeError: player.name.trim is not a function", "TypeError: … is not a function"],
      [`SyntaxError: Unexpected token '}', "{"Alex":}" is not valid JSON`, "SyntaxError: Invalid JSON"],
      [
        "TypeError: Failed to fetch dynamically imported module: https://poker.example/assets/PlayMode-sj1Bl2Qa.js?v=1",
        "TypeError: Failed to load a module"
      ],
      ["RangeError: Invalid currency code : alexSmith", "RangeError: Invalid Intl option"],
      ["QuotaExceededError: The quota has been exceeded.", "QuotaExceededError: Quota exceeded"]
    ];
    for (const [raw, expected] of cases) {
      expect(message(raw)).toBe(expected);
      expect(message(expected)).toBe(expected);
    }
  });

  it("withholds every message it does not recognize, whatever the error type", () => {
    const leaks = [
      "TypeError: Alex paid Bob 125.50",
      "TypeError: Cannot use 'in' operator to search for 'x' in alexSmith",
      "RangeError: Value Alex\u0000Bob out of range for Intl.NumberFormat options property style",
      "QuotaExceededError: Blair owes Casey $40",
      "Error: Alex owes Blair $125.50",
      "ConvexError: Room for Alex not found",
      "Alex paid Bob 125.50",
      "AlexError: boom",
      "Alex (message withheld)"
    ];
    for (const text of leaks) {
      const normalized = normalizeErrorReport({ ...report, message: text }).message;
      expect(normalized).toMatch(/^[A-Za-z]+ \(message withheld\)$/);
      expect(normalized).not.toMatch(/Alex|Bob|Blair|Casey|125|40/);
      expect(normalizeErrorReport({ ...report, message: normalized }).message).toBe(normalized);
    }
    expect(normalizeErrorReport({ ...report, message: "Non-error value (string)" }).message).toBe("Non-error value (string)");
    expect(normalizeErrorReport({ ...report, message: "Non-error value (alex)" }).message).toBe("Non-error value (object)");
  });

  it("keeps no function names and only the app's own loaded scripts in stacks", () => {
    const secret = "ZqxTaBcDeFgHiJkLmNoPqRsTuVwXyZab";
    const stack = [
      `    at handler (https://poker.example/#invite=${secret}:1:2)`,
      "    at load (data:text/javascript,alert('Alex'):1:1)",
      "    at Object.Alex (https://poker.example/assets/index-DKCiE8wL.js:1:2)",
      `    at x (https://poker.example/assets/${secret}-abcdefgh.js:1:2)`,
      "    at async https://poker.example/assets/index-DKCiE8wL.js:7:9",
      "    at chrome-extension://abc/content.js:9:9",
      "Alex@https://poker.example/assets/index-DKCiE8wL.js:5:6"
    ].join("\n");
    const loaded = (path: string) => path === "/assets/index-DKCiE8wL.js";
    const normalized = normalizeErrorReport({ ...report, stack }, loaded).stack;
    expect(normalized).toBe(
      [
        "at <external>",
        "at <external>",
        "at /assets/index-DKCiE8wL.js:1:2",
        "at <external>",
        "at /assets/index-DKCiE8wL.js:7:9",
        "at <external>",
        "at /assets/index-DKCiE8wL.js:5:6"
      ].join("\n")
    );
    expect(normalizeErrorReport({ ...report, stack: normalized }, loaded).stack).toBe(normalized);
  });

  it("drops a whole stack with any line that is not an ordinary frame (multiline computed names)", () => {
    const loaded = () => true;
    // V8's stack for a method named "Alex\n    at /assets/index-DKCiE8wL.js:125:50\n tail".
    const crafted = [
      "    at Object.Alex",
      "    at /assets/index-DKCiE8wL.js:125:50",
      " tail (https://poker.example/assets/index-DKCiE8wL.js:1:2)",
      "    at https://poker.example/assets/index-DKCiE8wL.js:3:4"
    ].join("\n");
    expect(normalizeErrorReport({ ...report, stack: crafted }, loaded).stack).toBeUndefined();
    expect(normalizeErrorReport({ ...report, stack: "Alex paid Blair\n    at f (https://poker.example/assets/index-DKCiE8wL.js:1:2)" }, loaded).stack).toBeUndefined();
    expect(normalizeErrorReport({ ...report, stack: "    at Array.map (<anonymous>)\n    at f (https://poker.example/assets/index-DKCiE8wL.js:1:2)" }, loaded).stack).toBe(
      "at <external>\nat /assets/index-DKCiE8wL.js:1:2"
    );
  });

  it("keeps only the root path, a commit or build time, and a browser summary from fixed lists", () => {
    const normalized = normalizeErrorReport({ ...report, path: "/join#invite=abc", userAgent: SAFARI_IOS });
    expect(normalized.path).toBe("<other>");
    expect(normalizeErrorReport({ ...report, path: "/?x=1#invite=abc" }).path).toBe("/");
    expect(normalized.userAgent).toBe("Safari 18 · iOS");
    expect(summarizeUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0")).toBe("Firefox 131 · Windows");
    for (const userAgent of ["Alex's phone", "Alex · Blair", "Chrome · Alex"]) {
      expect(summarizeUserAgent(userAgent)).toMatch(/^Other · Other$/);
    }
    expect(normalizeErrorReport({ ...report, build: "2026-10-16T12:00:00.000Z" }).build).toBe("2026-10-16T12:00:00.000Z");
    for (const build of ["Alex_paid_Bob_125.50", "ABCDEFGHJKLMNPQRSTUV", "a b/c"]) {
      expect(normalizeErrorReport({ ...report, build }).build).toBe("unknown");
    }
  });

  it("stays fast on oversized hostile input", () => {
    const started = performance.now();
    normalizeErrorReport({
      ...report,
      message: `TypeError: ${"https://".repeat(200_000)}`,
      stack: `${"    at x (https://".repeat(100_000)}\n`.repeat(3),
      path: "/".repeat(1_000_000),
      build: "a".repeat(1_000_000),
      userAgent: "Chrome/".repeat(200_000)
    });
    expect(performance.now() - started).toBeLessThan(200);
  });

  it("groups repeats by kind, message, top frame, and build", () => {
    const normalized = normalizeErrorReport(report);
    expect(errorFingerprint(normalized)).toBe(
      errorFingerprint(normalizeErrorReport({ ...report, message: report.message.replace("name", "id") }))
    );
    expect(errorFingerprint(normalized)).not.toBe(errorFingerprint({ ...normalized, build: "def4567" }));
    expect(errorFingerprint(normalized)).not.toBe(errorFingerprint({ ...normalized, kind: "rejection" }));
  });
});

describe("error reporter", () => {
  function reporter(online = true) {
    const send = vi.fn(() => Promise.resolve());
    const report = createErrorReporter({
      deploymentUrl: "https://example.convex.cloud",
      build: "abc123f",
      send,
      location: { pathname: "/" },
      navigator: { userAgent: CHROME_ANDROID, onLine: online },
      isLoadedScript: () => true
    });
    return { report, send };
  }

  it("posts each distinct error once to the Convex HTTP API", () => {
    const { report, send } = reporter();
    const error = new TypeError("player.name is undefined");
    report("error", error);
    report("error", error);
    expect(send).toHaveBeenCalledTimes(1);
    const [url, body] = send.mock.calls[0] as unknown as [string, string];
    expect(url).toBe("https://example.convex.cloud/api/mutation");
    expect(JSON.parse(body)).toMatchObject({
      path: "clientErrors:report",
      format: "json",
      args: { kind: "error", message: "TypeError: … is undefined", path: "/", build: "abc123f", userAgent: "Chrome 140 · Android" }
    });
  });

  it("cuts the error's own message off its stack, even when the message looks like frames", () => {
    const { report, send } = reporter();
    const error = new RangeError("Invalid currency code : alexSmith\n    at /assets/index-DKCiE8wL.js:125:50");
    error.stack = `${error.name}: ${error.message}\n    at render (https://poker.example/assets/index-DKCiE8wL.js:3:4)`;
    report("error", error);
    const [, body] = send.mock.calls[0] as unknown as [string, string];
    expect(JSON.parse(body).args).toMatchObject({
      message: "RangeError: Invalid Intl option",
      stack: "at /assets/index-DKCiE8wL.js:3:4"
    });
  });

  it("drops a multiline-message stack it cannot separate from its frames", () => {
    const { report, send } = reporter();
    const error = new TypeError("first line\n    at /assets/index-DKCiE8wL.js:125:50");
    error.stack = `Something else first\n${error.message}`;
    report("error", error);
    const [, body] = send.mock.calls[0] as unknown as [string, string];
    expect(JSON.parse(body).args.stack).toBeUndefined();
  });

  it("names only scripts this page loaded from its own origin", () => {
    const own = document.createElement("script");
    own.src = `${window.location.origin}/assets/index-DKCiE8wL.js`;
    const foreign = document.createElement("script");
    foreign.src = "https://cdn.example/assets/Alex_paid_Bob-abcdefgh.js";
    document.head.append(own, foreign);
    const send = vi.fn(() => Promise.resolve());
    const report = createErrorReporter({
      deploymentUrl: "https://example.convex.cloud",
      build: "abc123f",
      send,
      location: { pathname: "/" },
      navigator: { userAgent: CHROME_ANDROID, onLine: true }
    });
    const error = new TypeError("x is not a function");
    error.stack = [
      "TypeError: x is not a function",
      `    at a (${window.location.origin}/assets/index-DKCiE8wL.js:1:2)`,
      "    at b (https://cdn.example/assets/Alex_paid_Bob-abcdefgh.js:3:4)"
    ].join("\n");
    report("error", error);
    own.remove();
    foreign.remove();
    const [, body] = send.mock.calls[0] as unknown as [string, string];
    expect(JSON.parse(body).args.stack).toBe("at /assets/index-DKCiE8wL.js:1:2\nat <external>");
  });

  it("sends at most a few reports per page", () => {
    const { report, send } = reporter();
    const messages = ["x is not a function", "x is not iterable", "x is not defined", "Invalid time value", "Invalid array length", "Maximum call stack size exceeded"];
    for (const message of messages) report("error", new TypeError(message));
    expect(send).toHaveBeenCalledTimes(MAX_REPORTS_PER_PAGE);
  });

  it("ignores noise, extensions, and chunk failures while offline", () => {
    const { report, send } = reporter(false);
    report("error", new Error("Script error."));
    report("error", new Error("ResizeObserver loop completed with undelivered notifications."));
    const foreign = new Error("boom");
    foreign.stack = "Error: boom\n    at x (chrome-extension://abc/content.js:1:1)";
    report("error", foreign);
    report("render", new TypeError("Failed to fetch dynamically imported module: /assets/PlayMode-x.js"));
    expect(send).not.toHaveBeenCalled();
  });

  it("reports only the type of a rejected string or object, never its contents", () => {
    const { report, send } = reporter();
    report("rejection", "Alex paid Bob 125.50");
    report("rejection", { players: [{ name: "Alex" }] });
    const messages = send.mock.calls.map((call) => JSON.parse((call as unknown as [string, string])[1]).args.message);
    expect(messages).toEqual(["Non-error value (string)", "Non-error value (object)"]);
  });

  it("never throws when sending fails", async () => {
    const send = vi.fn(() => Promise.reject(new Error("offline")));
    const report = createErrorReporter({
      deploymentUrl: "https://example.convex.cloud",
      build: "abc123",
      send,
      location: { pathname: "/" },
      navigator: { userAgent: "Test", onLine: true }
    });
    expect(() => report("error", new Error("boom"))).not.toThrow();
    await Promise.resolve();
  });
});
