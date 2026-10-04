import { StructuredLogEntry, writeStructuredLog } from "./structured_logging";

/**
 * Components that silently fall back to a degraded path. Keep this a closed
 * union: it becomes a log-based-metric label, so it must stay low-cardinality.
 */
export type DegradedFallbackComponent =
  | "agent_runtime.adk"
  | "agent_runtime.vertex"
  | "agent_runtime.langgraph"
  | "agent_runtime.remote_worker"
  | "embeddings.vertex"
  | "embeddings.provider"
  | "taste_profile"
  | "served_history"
  | "discovery_policy_context";

export const DEGRADED_FALLBACK_EVENT = "degraded.fallback";

const REASON_PATTERN = /^[a-z][a-z0-9_]{0,47}$/;

type LogWriter = (line: string) => void;

function sanitizeReason(reason: unknown): string {
  const candidate = typeof reason === "string" ? reason.toLowerCase() : "";
  return REASON_PATTERN.test(candidate) ? candidate : "other";
}

/**
 * Emit a categorical `degraded.fallback` event (#2076). Only the component, a
 * bounded reason and the error class are logged - never error messages, user
 * ids, track ids or free text. Never throws: observability must not break the
 * fallback path it reports on.
 */
export function logDegradedFallback(
  input: {
    component: DegradedFallbackComponent;
    reason: string;
    error?: unknown;
  },
  writer?: LogWriter,
): void {
  try {
    const reason = sanitizeReason(input.reason);
    const entry: StructuredLogEntry = {
      level: "warn",
      event: DEGRADED_FALLBACK_EVENT,
      message: `${input.component} fell back (${reason})`,
      component: input.component,
      reason,
      ...(input.error instanceof Error
        ? { errorClass: String(input.error.name).slice(0, 128) }
        : {}),
    };
    writeStructuredLog(entry, writer);
  } catch {
    // Swallowed on purpose.
  }
}
