/**
 * Turns browser Content-Security-Policy violation reports into short,
 * bounded log records.
 *
 * Browsers send reports in two shapes:
 * - the older `report-uri` shape: `{ "csp-report": { "document-uri": … } }`
 *   with `Content-Type: application/csp-report`;
 * - the newer Reporting API shape: `[{ "type": "csp-violation", "body": { "documentURL": … } }]`
 *   with `Content-Type: application/reports+json`.
 *
 * Reports are written by any visitor's browser (or by anyone with curl), so
 * every field is treated as untrusted: URLs are cut down to origin + path
 * (no query string, which could carry a token), strings are truncated, and at
 * most a few reports per request are kept.
 */

export type CspViolation = {
  documentPath: string;
  blocked: string;
  directive: string;
  disposition: string;
  sourceFile?: string;
  line?: number;
  sample?: string;
};

export const MAX_REPORTS_PER_REQUEST = 10;
const MAX_FIELD_LENGTH = 200;

function text(value: unknown): string {
  return typeof value === "string" ? value.slice(0, MAX_FIELD_LENGTH) : "";
}

/** Keeps CSP keywords (`inline`, `eval`, `data`) and reduces URLs to origin + path. */
export function safeLocation(value: unknown): string {
  const raw = text(value);
  if (!raw) return "";
  if (!raw.includes(":") || /^[a-z-]+$/i.test(raw)) return raw;
  try {
    const url = new URL(raw);
    if (url.protocol === "http:" || url.protocol === "https:" || url.protocol === "wss:" || url.protocol === "ws:") {
      return `${url.origin}${url.pathname}`.slice(0, MAX_FIELD_LENGTH);
    }
    return url.protocol.replace(/:$/, "");
  } catch {
    return "";
  }
}

function safePath(value: unknown): string {
  const location = safeLocation(value);
  try {
    return new URL(location).pathname;
  } catch {
    return location;
  }
}

function lineNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function fromLegacy(report: Record<string, unknown>): CspViolation {
  return {
    documentPath: safePath(report["document-uri"]),
    blocked: safeLocation(report["blocked-uri"]),
    directive: text(report["effective-directive"] || report["violated-directive"]).split(" ")[0] ?? "",
    disposition: text(report.disposition) || "report",
    sourceFile: safeLocation(report["source-file"]) || undefined,
    line: lineNumber(report["line-number"]),
    sample: text(report["script-sample"]).slice(0, 40) || undefined,
  };
}

function fromReportingApi(body: Record<string, unknown>): CspViolation {
  return {
    documentPath: safePath(body.documentURL),
    blocked: safeLocation(body.blockedURL),
    directive: text(body.effectiveDirective),
    disposition: text(body.disposition) || "report",
    sourceFile: safeLocation(body.sourceFile) || undefined,
    line: lineNumber(body.lineNumber),
    sample: text(body.sample).slice(0, 40) || undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parses either report shape; anything unrecognised yields no violations. */
export function parseCspReports(payload: unknown): CspViolation[] {
  if (isRecord(payload) && isRecord(payload["csp-report"])) {
    return [fromLegacy(payload["csp-report"])];
  }
  if (Array.isArray(payload)) {
    return payload
      .slice(0, MAX_REPORTS_PER_REQUEST)
      .filter((entry): entry is Record<string, unknown> => isRecord(entry) && entry.type === "csp-violation")
      .filter((entry) => isRecord(entry.body))
      .map((entry) => fromReportingApi(entry.body as Record<string, unknown>));
  }
  return [];
}

/**
 * A per-instance budget so a flood of fake reports can't inflate the log
 * bill: at most `limit` reports are logged per window; the rest are dropped
 * quietly (the browser still gets its 204).
 */
export function createReportBudget(limit: number, windowMs: number, now: () => number = Date.now) {
  let windowStart = now();
  let used = 0;
  return {
    take(count: number): number {
      const current = now();
      if (current - windowStart >= windowMs) {
        windowStart = current;
        used = 0;
      }
      const granted = Math.max(0, Math.min(count, limit - used));
      used += granted;
      return granted;
    },
  };
}
