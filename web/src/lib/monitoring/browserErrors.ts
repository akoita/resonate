/**
 * Browser error reporting without a third-party service.
 *
 * The browser fires `error` for uncaught exceptions (React 19 also routes
 * uncaught render errors there) and `unhandledrejection` for promises nobody
 * awaited. We catch both, shrink each to a small JSON report, and beacon it
 * to our own `/api/browser-reports/error`. That route writes it to Cloud
 * Logging in the format Cloud Error Reporting understands, so browser errors
 * are grouped next to the backend's, with counts, first/last seen and stack.
 *
 * Privacy and cost: no user id, no cookies, no query strings, short
 * messages, at most a few reports per page load, and repeated errors are
 * sent once.
 */

export const BROWSER_ERROR_ENDPOINT = "/api/browser-reports/error";
export const MAX_REPORTS_PER_PAGE = 5;
const MAX_MESSAGE = 300;
const MAX_STACK = 4000;

export type BrowserErrorKind = "error" | "unhandledrejection";

export type BrowserErrorReport = {
  kind: BrowserErrorKind;
  name: string;
  message: string;
  stack?: string;
  source?: string;
  line?: number;
  column?: number;
  path: string;
};

/** Drops the query string and fragment from a URL or path. */
export function withoutQuery(value: string): string {
  return value.replace(/[?#].*$/, "");
}

function describe(reason: unknown): { name: string; message: string; stack?: string } {
  if (reason instanceof Error) {
    return { name: reason.name || "Error", message: reason.message, stack: reason.stack };
  }
  if (typeof reason === "string") return { name: "Error", message: reason };
  try {
    return { name: "NonError", message: JSON.stringify(reason) ?? String(reason) };
  } catch {
    return { name: "NonError", message: String(reason) };
  }
}

/** Removes query strings from URLs inside a stack trace. */
function cleanStack(stack: string): string {
  return stack.replace(/(https?:\/\/[^\s)?#]+)[?#][^\s):]*/g, "$1").slice(0, MAX_STACK);
}

export function buildReport(
  kind: BrowserErrorKind,
  reason: unknown,
  location: { pathname: string },
  where?: { source?: string; line?: number; column?: number },
): BrowserErrorReport {
  const { name, message, stack } = describe(reason);
  return {
    kind,
    name: name.slice(0, 80),
    message: message.slice(0, MAX_MESSAGE),
    stack: stack ? cleanStack(stack) : undefined,
    source: where?.source ? withoutQuery(where.source).slice(0, 300) : undefined,
    line: where?.line,
    column: where?.column,
    path: withoutQuery(location.pathname).slice(0, 200),
  };
}

type ReporterWindow = Pick<Window, "addEventListener" | "location"> & {
  navigator: Pick<Navigator, "sendBeacon">;
};

/**
 * Installs the listeners. Returns a function that removes them (for tests).
 * `send` defaults to `navigator.sendBeacon`, which survives page unload and
 * never blocks the page.
 */
export function installBrowserErrorReporting(
  win: ReporterWindow,
  send: (body: string) => void = (body) => {
    win.navigator.sendBeacon(BROWSER_ERROR_ENDPOINT, new Blob([body], { type: "application/json" }));
  },
): () => void {
  const seen = new Set<string>();
  let sent = 0;

  const report = (entry: BrowserErrorReport) => {
    const key = `${entry.name}:${entry.message}:${entry.source ?? ""}:${entry.line ?? ""}`;
    if (seen.has(key) || sent >= MAX_REPORTS_PER_PAGE) return;
    seen.add(key);
    sent += 1;
    try {
      send(JSON.stringify(entry));
    } catch {
      // Reporting must never break the page.
    }
  };

  const onError = (event: Event) => {
    // Bubble phase only: failed <img>/<script> loads fire `error` on the
    // element without bubbling, so network failures don't land here.
    const errorEvent = event as ErrorEvent;
    report(
      buildReport("error", errorEvent.error ?? errorEvent.message, win.location, {
        source: errorEvent.filename,
        line: errorEvent.lineno,
        column: errorEvent.colno,
      }),
    );
  };

  const onRejection = (event: Event) => {
    report(buildReport("unhandledrejection", (event as PromiseRejectionEvent).reason, win.location));
  };

  win.addEventListener("error", onError);
  win.addEventListener("unhandledrejection", onRejection);
  return () => {
    (win as Window).removeEventListener?.("error", onError);
    (win as Window).removeEventListener?.("unhandledrejection", onRejection);
  };
}

/** Validates and bounds a report received by the server route. */
export function parseBrowserErrorReport(payload: unknown): BrowserErrorReport | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const value = payload as Record<string, unknown>;
  const text = (field: unknown, max: number) => (typeof field === "string" ? field.slice(0, max) : undefined);
  const int = (field: unknown) =>
    typeof field === "number" && Number.isInteger(field) && field >= 0 && field < 10_000_000 ? field : undefined;
  const kind = value.kind === "unhandledrejection" ? "unhandledrejection" : value.kind === "error" ? "error" : null;
  const message = text(value.message, MAX_MESSAGE);
  if (!kind || message === undefined) return null;
  const stack = text(value.stack, MAX_STACK);
  const source = text(value.source, 300);
  return {
    kind,
    name: text(value.name, 80) || "Error",
    message,
    stack: stack ? cleanStack(stack) : undefined,
    source: source ? withoutQuery(source) : undefined,
    line: int(value.line),
    column: int(value.column),
    path: withoutQuery(text(value.path, 200) || "/"),
  };
}
