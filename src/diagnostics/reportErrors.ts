/**
 * Sends uncaught browser errors to the app's own Convex deployment
 * (convex/clientErrors.ts) through Convex's HTTP API, so reporting needs
 * neither the realtime client chunk nor a socket. Production builds with a
 * deployment only. A page sends each distinct error once and at most
 * MAX_REPORTS_PER_PAGE in all; failures to report are ignored.
 */
import {
  builtScriptPath,
  errorFingerprint,
  normalizeErrorReport,
  type ErrorReport,
  type ErrorReportKind
} from "./errorReport";

export const MAX_REPORTS_PER_PAGE = 5;

/** Noise that says nothing about this app: cross-origin script errors and browser layout warnings. */
const IGNORED_MESSAGES = [/^Script error\.?$/i, /ResizeObserver loop/i];
/** Code that is not the app's, such as browser extensions. */
const FOREIGN_SOURCES = /(?:chrome|moz|safari|safari-web)-extension:\/\//;
/** A lazy chunk failing to load while offline is expected; the app shows a reload notice. */
const CHUNK_LOAD_FAILURE = /dynamically imported module|Importing a module script failed|Failed to fetch/i;

type Send = (url: string, body: string) => Promise<unknown>;

export type ErrorReporterOptions = {
  deploymentUrl: string;
  build: string;
  send?: Send;
  location?: Pick<Location, "pathname">;
  navigator?: Pick<Navigator, "userAgent" | "onLine">;
  isLoadedScript?: (path: string) => boolean;
};

export type ErrorReporter = (kind: ErrorReportKind, error: unknown) => void;

function describe(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) return { message: `${error.name}: ${error.message}`, stack: stackFrames(error) };
  // Only the type: a rejected string or object could hold game data.
  const type = error === null ? "null" : Array.isArray(error) ? "array" : typeof error;
  return { message: `Non-error value (${type})` };
}

/**
 * The frames of an error's stack without its header. V8 starts the stack with
 * "Name: message", and a message can span lines that look like frames (an
 * engine message quoting a value with a newline), so the header is cut off
 * whole rather than parsed.
 */
function stackFrames(error: Error): string | undefined {
  const stack = typeof error.stack === "string" ? error.stack : undefined;
  if (!stack) return undefined;
  const header = error.message ? `${error.name}: ${error.message}` : error.name;
  if (stack.startsWith(header)) return stack.slice(header.length);
  // Not V8's form: Gecko and WebKit stacks are frames only, unless a header precedes them anyway.
  return stack.includes(error.message) && error.message.includes("\n") ? undefined : stack;
}

/** Whether this page loaded the script at `path` from its own origin (so a stack can name it). */
function loadedByThisPage(path: string): boolean {
  const urls = [
    ...Array.from(document.scripts, (script) => script.src),
    ...performance.getEntriesByType("resource").map((entry) => entry.name)
  ];
  return urls.some((url) => {
    try {
      return new URL(url).origin === window.location.origin && builtScriptPath(url) === path;
    } catch {
      return false;
    }
  });
}

const defaultSend: Send = (url, body) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });

export function createErrorReporter({
  deploymentUrl,
  build,
  send = defaultSend,
  location = window.location,
  navigator: browser = window.navigator,
  isLoadedScript = loadedByThisPage
}: ErrorReporterOptions): ErrorReporter {
  const sent = new Set<string>();
  let reporting = false;
  return (kind, error) => {
    // An error thrown while reporting must not report itself.
    if (reporting || sent.size >= MAX_REPORTS_PER_PAGE) return;
    reporting = true;
    try {
      const { message, stack } = describe(error);
      const ownMessage = error instanceof Error ? error.message : "";
      if (IGNORED_MESSAGES.some((pattern) => pattern.test(ownMessage))) return;
      if (stack && FOREIGN_SOURCES.test(stack)) return;
      if (!browser.onLine && CHUNK_LOAD_FAILURE.test(ownMessage)) return;
      const report: ErrorReport = normalizeErrorReport(
        {
          kind,
          message,
          ...(stack ? { stack } : {}),
          path: location.pathname,
          build,
          userAgent: browser.userAgent
        },
        isLoadedScript
      );
      const fingerprint = errorFingerprint(report);
      if (sent.has(fingerprint)) return;
      sent.add(fingerprint);
      void send(
        `${deploymentUrl}/api/mutation`,
        JSON.stringify({ path: "clientErrors:report", args: report, format: "json" })
      ).catch(() => undefined);
    } catch {
      // Reporting is best effort.
    } finally {
      reporting = false;
    }
  };
}

/**
 * Some browsers raise error events without an error object, only a message
 * such as "Uncaught TypeError: x is undefined"; this recovers its type so the
 * message is treated like the error's own (see normalizeErrorReport).
 */
function errorFromEventMessage(message: unknown): Error {
  const text = typeof message === "string" ? message.replace(/^Uncaught /, "") : "";
  const match = /^([A-Za-z]{1,40}): ([^]*)$/.exec(text);
  const error = new Error(match ? match[2] : text);
  error.name = match ? match[1] : "Error";
  error.stack = undefined;
  return error;
}

/** Reports window errors and unhandled promise rejections; returns the reporter for React's root callbacks. */
export function installErrorReporting(options: ErrorReporterOptions): ErrorReporter {
  const report = createErrorReporter(options);
  window.addEventListener("error", (event) => {
    if (event.filename && FOREIGN_SOURCES.test(event.filename)) return;
    report("error", event.error ?? errorFromEventMessage(event.message));
  });
  window.addEventListener("unhandledrejection", (event) => report("rejection", event.reason));
  return report;
}
