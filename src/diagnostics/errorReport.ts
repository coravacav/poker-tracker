/**
 * Shape and scrubbing of client error reports, shared by the browser reporter
 * (src/diagnostics/reportErrors.ts) and the Convex function that stores them
 * (convex/clientErrors.ts), which normalizes again rather than trusting clients.
 *
 * Reports must never carry game data (names, amounts, notes) or secrets
 * (room capabilities, invitation and friend codes). Engine messages can embed
 * values (an Intl option, a JSON snippet, a property name), so no text from an
 * error survives; every stored field is chosen from fixed strings:
 *
 * - message: an error type from a fixed list plus, when the message matches a
 *   known engine wording, that wording's fixed summary (MESSAGE_TEMPLATES, with
 *   no value slots); otherwise "(message withheld)". Values that are not
 *   errors are named by type only.
 * - stack: frame positions only, `at /assets/<script>.js:line:column` for the
 *   app's own built scripts (the browser also checks the page loaded it) and
 *   `at <external>` otherwise; function names are dropped, since computed
 *   names can hold data.
 * - path `/` or `<other>`; build a commit hash or build time; userAgent a
 *   browser family, major version, and OS from fixed lists.
 *
 * Every field is cut to a fixed length before any pattern runs, and the
 * patterns are linear, so oversized input cannot make normalization slow.
 * A client that posts its own made-up report can only store text of these
 * shapes.
 */

export const ERROR_REPORT_KINDS = ["error", "rejection", "render"] as const;
export type ErrorReportKind = (typeof ERROR_REPORT_KINDS)[number];

export type ErrorReport = {
  kind: ErrorReportKind;
  message: string;
  stack?: string;
  path: string;
  build: string;
  userAgent: string;
};

const MAX_RAW_MESSAGE = 1000;
const MAX_RAW_STACK = 8000;
const MAX_RAW_FIELD = 400;
const MAX_FRAME_LINE = 400;
const MAX_FRAMES = 15;

/** Errors whose messages the engine writes; known wordings are kept as fixed summaries (MESSAGE_TEMPLATES). */
const ENGINE_ERRORS = new Set([
  "TypeError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "URIError",
  "EvalError",
  "AggregateError",
  "AbortError",
  "ConstraintError",
  "DataCloneError",
  "DataError",
  "InvalidAccessError",
  "InvalidStateError",
  "NetworkError",
  "NotAllowedError",
  "NotFoundError",
  "NotReadableError",
  "NotSupportedError",
  "OperationError",
  "QuotaExceededError",
  "ReadOnlyError",
  "SecurityError",
  "TimeoutError",
  "TransactionInactiveError",
  "UnknownError",
  "VersionError"
]);

/** Error types reported by name only (their messages come from app or library code). */
const OTHER_ERRORS = new Set(["Error", "ConvexError", "ChunkLoadError", "DOMException", "InternalError"]);

/** What a value that is not an error is reported as. */
export const NON_ERROR_TYPES = ["string", "number", "boolean", "undefined", "null", "symbol", "bigint", "function", "object", "array"] as const;

/** A browser's version or OS name as reported. */
const BROWSER_FAMILIES = ["Edge", "Firefox", "Chrome", "Safari", "Other"] as const;
const SYSTEMS = ["Android", "iOS", "macOS", "Windows", "ChromeOS", "Linux", "Other"] as const;

/** A path in the app's own build output: Vite's `/assets/<name>-<8-character hash>.js`. */
const BUILT_SCRIPT = /^\/assets\/[A-Za-z][\w.]{0,39}-[\w-]{8}\.js$/;

/** The app script path a URL points at, or null. */
export function builtScriptPath(url: string): string | null {
  const path = url
    .slice(0, MAX_RAW_FIELD)
    .replace(/^[a-z][a-z0-9+.-]{0,20}:\/\/[^/?#\s]*/i, "")
    .split(/[?#]/)[0];
  return BUILT_SCRIPT.test(path) ? path : null;
}

/**
 * Known engine wordings and the fixed summary each is stored as. Each pattern
 * also matches its own summary, so normalizing twice changes nothing.
 */
const MESSAGE_TEMPLATES: Array<[RegExp, string]> = [
  [/Cannot read propert(?:y|ies) of undefined/, "Cannot read properties of undefined"],
  [/Cannot read propert(?:y|ies) of null/, "Cannot read properties of null"],
  [/Cannot set propert(?:y|ies) of undefined/, "Cannot set properties of undefined"],
  [/Cannot set propert(?:y|ies) of null/, "Cannot set properties of null"],
  [/^undefined is not an object/, "undefined is not an object"],
  [/^null is not an object/, "null is not an object"],
  [/is not a function/, "… is not a function"],
  [/is not iterable/, "… is not iterable"],
  [/is not a constructor/, "… is not a constructor"],
  [/is not defined/, "… is not defined"],
  [/before initialization/, "Cannot access … before initialization"],
  [/Assignment to constant variable/, "Assignment to constant variable"],
  [/ is undefined$/, "… is undefined"],
  [/ is null$/, "… is null"],
  [/dynamically imported module|Importing a module script failed|Failed to load a module/, "Failed to load a module"],
  [/^Failed to fetch$|^Load failed$|NetworkError when attempting to fetch/, "Failed to fetch"],
  [/Maximum call stack size exceeded|too much recursion/, "Maximum call stack size exceeded"],
  [/Invalid time value|Invalid Date/, "Invalid time value"],
  [/Invalid array length/, "Invalid array length"],
  [/not valid JSON|Unexpected token|Unexpected end of JSON input|JSON\.parse|JSON Parse error|Invalid JSON/, "Invalid JSON"],
  [/circular structure|cyclic object value|Circular structure/i, "Circular structure"],
  [/[Ii]nvalid currency code|[Ii]ncorrect locale|[Ii]nvalid language tag|Invalid Intl option/, "Invalid Intl option"],
  [/quota/i, "Quota exceeded"],
  [/transaction (?:was|has been) aborted|Transaction aborted/i, "Transaction aborted"],
  [/database connection is closing/i, "Database connection is closing"],
  [/operation was aborted|signal is aborted|Operation aborted/i, "Operation aborted"],
  [/not allowed|permission denied/i, "Not allowed"]
];

function normalizeMessage(raw: string): string {
  const message = raw.slice(0, MAX_RAW_MESSAGE).trim();
  const nonError = /^Non-error value \(([a-z]{1,10})\)$/.exec(message);
  if (nonError) {
    return `Non-error value (${(NON_ERROR_TYPES as readonly string[]).includes(nonError[1]) ? nonError[1] : "object"})`;
  }
  const match = /^([A-Za-z]{1,40})(?::(?: |$)| \(message withheld\)$|$)/.exec(message);
  const rawName = match?.[1] ?? "Error";
  const name = ENGINE_ERRORS.has(rawName) || OTHER_ERRORS.has(rawName) ? rawName : "Error";
  if (!ENGINE_ERRORS.has(name) || !match) return `${name} (message withheld)`;
  const body = message.slice(match[0].length);
  const template = MESSAGE_TEMPLATES.find(([pattern]) => pattern.test(body))?.[1];
  return template ? `${name}: ${template}` : `${name} (message withheld)`;
}

/** One stack line as `at /assets/file.js:1:2` (or `at <external>`), or null when it is not a frame. */
function normalizeFrame(rawLine: string, isLoadedScript: (path: string) => boolean): string | null {
  const line = rawLine.slice(0, MAX_FRAME_LINE).trim();
  let location: string;
  if (line.startsWith("at ")) {
    // V8: `at fn (url:1:2)`, `at url:1:2`, `at async url:1:2`.
    const rest = line.slice(3);
    const open = rest.lastIndexOf(" (");
    if (open >= 0 && rest.endsWith(")")) {
      location = rest.slice(open + 2, -1);
    } else {
      location = rest.replace(/^async /, "");
    }
  } else if (line.includes("@")) {
    // Gecko and WebKit: `fn@url:1:2`.
    location = line.slice(line.lastIndexOf("@") + 1);
  } else {
    return null;
  }
  const position = /:(\d{1,7}):(\d{1,7})$/.exec(location);
  const script = position ? builtScriptPath(location.slice(0, position.index)) : null;
  return script && position && isLoadedScript(script) ? `at ${script}:${position[1]}:${position[2]}` : "at <external>";
}

/** Where a frame may point besides `url:line:column`: engine-internal and already-normalized frames. */
const OTHER_LOCATIONS = /^(?:<anonymous>|<external>|native|\[native code\]|index \d{1,4})$/;

/**
 * Whether a stack line is a whole, ordinary frame. A frame's function name
 * can span lines (computed names), and its pieces would read as frames of
 * their own, so a stack with any other non-empty line is not trusted at all.
 */
function wellFormedFrame(rawLine: string): boolean {
  const line = rawLine.slice(0, MAX_FRAME_LINE).trim();
  let location: string;
  if (line.startsWith("at ")) {
    const rest = line.slice(3);
    const open = rest.lastIndexOf(" (");
    location = open >= 0 && rest.endsWith(")") ? rest.slice(open + 2, -1) : rest.replace(/^async /, "");
  } else if (line.includes("@")) {
    location = line.slice(line.lastIndexOf("@") + 1);
  } else {
    return false;
  }
  return /:\d{1,7}:\d{1,7}$/.test(location) || OTHER_LOCATIONS.test(location);
}

function normalizeStack(raw: string | undefined, isLoadedScript: (path: string) => boolean): string | undefined {
  if (!raw) return undefined;
  const lines = raw
    .slice(0, MAX_RAW_STACK)
    .split("\n")
    .filter((line) => line.trim() !== "");
  if (!lines.every(wellFormedFrame)) return undefined;
  const frames = lines.flatMap((line) => normalizeFrame(line, isLoadedScript) ?? []).slice(0, MAX_FRAMES);
  return frames.length > 0 ? frames.join("\n") : undefined;
}

const BROWSER_PATTERNS: Array<[(typeof BROWSER_FAMILIES)[number], RegExp]> = [
  ["Edge", /Edg(?:e|A|iOS)?\/(\d{1,4})/],
  ["Firefox", /(?:Firefox|FxiOS)\/(\d{1,4})/],
  ["Chrome", /(?:Chrome|CriOS)\/(\d{1,4})/],
  ["Safari", /Version\/(\d{1,4})[^\s]* (?:Mobile\/\w+ )?Safari/]
];

const SYSTEM_PATTERNS: Array<[(typeof SYSTEMS)[number], RegExp]> = [
  ["Android", /Android/],
  ["iOS", /iPhone|iPad|iPod/],
  ["macOS", /Macintosh|Mac OS X/],
  ["Windows", /Windows/],
  ["ChromeOS", /CrOS/],
  ["Linux", /Linux/]
];

/** Browser family, major version, and OS, e.g. "Chrome 140 · Android". */
export function summarizeUserAgent(raw: string): string {
  const userAgent = raw.slice(0, MAX_RAW_FIELD);
  const summary = new RegExp(
    `^(${BROWSER_FAMILIES.join("|")})(?: (\\d{1,4}))? · (${SYSTEMS.join("|")})$`
  ).exec(userAgent);
  // Already summarized (the server sees the browser's summary): accepted only in this exact form.
  if (summary) return summary[1] === "Other" ? `Other · ${summary[3]}` : summary[2] ? userAgent : `Other · ${summary[3]}`;
  let browser = "Other";
  for (const [family, pattern] of BROWSER_PATTERNS) {
    const version = pattern.exec(userAgent)?.[1];
    if (version) {
      browser = `${family} ${version}`;
      break;
    }
  }
  const system = SYSTEM_PATTERNS.find(([, pattern]) => pattern.test(userAgent))?.[0] ?? "Other";
  return `${browser} · ${system}`;
}

/** A commit hash (7–40 hex digits) or an ISO build time; anything else is "unknown". */
function normalizeBuild(raw: string): string {
  const build = raw.slice(0, MAX_RAW_FIELD);
  return /^[0-9a-f]{7,40}$/.test(build) || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(build) ? build : "unknown";
}

/**
 * A report reduced to the allowlisted parts described above. Idempotent.
 * `isLoadedScript` lets the browser keep only scripts it really loaded; the
 * server, which cannot tell, accepts any path shaped like a built script.
 */
export function normalizeErrorReport(report: ErrorReport, isLoadedScript: (path: string) => boolean = () => true): ErrorReport {
  const stack = normalizeStack(report.stack, isLoadedScript);
  const path = report.path.slice(0, MAX_RAW_FIELD).split(/[?#]/)[0];
  return {
    kind: report.kind,
    message: normalizeMessage(report.message),
    ...(stack ? { stack } : {}),
    path: path === "/" || path === "" ? "/" : "<other>",
    build: normalizeBuild(report.build),
    userAgent: summarizeUserAgent(report.userAgent)
  };
}

/** 32-bit FNV-1a, hex. Enough to group repeats of one error; not a security boundary. */
function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Groups repeats of the same error from the same build: kind, normalized message, and top stack frame. */
export function errorFingerprint(report: ErrorReport): string {
  const topFrame = report.stack?.split("\n")[0] ?? "";
  return `${report.build}:${fnv1a(`${report.kind}\n${report.message}\n${topFrame}`)}`;
}
