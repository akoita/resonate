import { randomUUID } from "crypto";

export type JsonLogValue =
  | string
  | number
  | boolean
  | null
  | JsonLogValue[]
  | { [key: string]: JsonLogValue };

export type StructuredLogLevel = "debug" | "info" | "warn" | "error";

/** Cloud Logging severity names; `level` stays for existing consumers. */
export type StructuredLogSeverity = "DEBUG" | "INFO" | "WARNING" | "ERROR";

export interface StructuredLogEntry {
  level: StructuredLogLevel;
  event: string;
  message: string;
  requestId?: string;
  service?: string;
  /**
   * Optional caught error. It is never serialised as-is: only its class name
   * and (for `error` level) its stack reach the envelope.
   */
  error?: unknown;
  [key: string]: unknown;
}

type LogWriter = (line: string) => void;

const DEFAULT_SERVICE_NAME = "resonate-backend";
const MAX_STRING_LENGTH = 512;
const MAX_DEPTH = 6;
const MAX_ARRAY_LENGTH = 50;
const MAX_OBJECT_KEYS = 100;
const MAX_STACK_LENGTH = 8000;
const MAX_ERROR_CLASS_LENGTH = 128;
const ERROR_REPORTING_EVENT_TYPE =
  "type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent";

const SEVERITY_BY_LEVEL: Record<StructuredLogLevel, StructuredLogSeverity> = {
  debug: "DEBUG",
  info: "INFO",
  warn: "WARNING",
  error: "ERROR",
};

const SENSITIVE_KEY_PATTERN =
  /(authorization|cookie|password|secret|token|api[-_]?key|private[-_]?key|signature|payment[-_]?proof|x[-_]?payment|payment[-_]?signature|email|object[-_]?url|signed[-_]?url)/i;

export function normalizeRequestId(value: unknown): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate === "string") {
    const trimmed = candidate.trim();
    if (trimmed.length > 0 && trimmed.length <= 128) {
      return trimmed;
    }
  }
  return randomUUID();
}

export function redactForLog(value: unknown, depth = 0): JsonLogValue {
  if (depth > MAX_DEPTH) return "[truncated]";
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    return value.length > MAX_STRING_LENGTH
      ? `${value.slice(0, MAX_STRING_LENGTH)}...[truncated]`
      : value;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return value.message;
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_LENGTH).map((item) => redactForLog(item, depth + 1));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, MAX_OBJECT_KEYS)
        .map(([key, item]) => [
          key,
          SENSITIVE_KEY_PATTERN.test(key) ? "[redacted]" : redactForLog(item, depth + 1),
        ]),
    );
  }
  return String(value);
}

export function writeStructuredLog(
  entry: StructuredLogEntry,
  writer: LogWriter = console.info,
): void {
  const timestamp = new Date().toISOString();
  const { error, stack, ...rest } = entry;
  const errorObject = error instanceof Error ? error : undefined;
  const stackTrace =
    entry.level === "error"
      ? typeof errorObject?.stack === "string"
        ? errorObject.stack
        : typeof stack === "string"
        ? stack
        : undefined
      : undefined;
  const payload = redactForLog({
    service: DEFAULT_SERVICE_NAME,
    timestamp,
    ...rest,
    // Existing callers pass a plain `error` message string; keep it as-is.
    ...(errorObject === undefined && error !== undefined ? { error } : {}),
    ...(stackTrace === undefined && stack !== undefined ? { stack } : {}),
    severity: SEVERITY_BY_LEVEL[entry.level] ?? "INFO",
  }) as { [key: string]: JsonLogValue };

  if (errorObject) {
    payload.errorClass = String(errorObject.name).slice(0, MAX_ERROR_CLASS_LENGTH);
  }

  // Added after redaction so the 512-char string cap does not cut the stack.
  // Cloud Error Reporting groups entries that carry these fields (#2076).
  if (stackTrace) {
    payload.stack_trace = stackTrace.slice(0, MAX_STACK_LENGTH);
    payload["@type"] = ERROR_REPORTING_EVENT_TYPE;
    payload.serviceContext = {
      service:
        typeof payload.service === "string" ? payload.service : DEFAULT_SERVICE_NAME,
    };
  }
  writer(JSON.stringify(payload));
}
