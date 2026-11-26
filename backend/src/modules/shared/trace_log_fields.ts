import { context, trace } from "@opentelemetry/api";

/**
 * Joins log lines to the active OpenTelemetry trace (see `src/tracing.ts`).
 *
 * Cloud Logging reads these special fields and links each entry to its trace
 * in Cloud Trace, so a slow or failing request shows its own logs:
 * https://cloud.google.com/logging/docs/structured-logging#special-payload-fields
 *
 * Only the OpenTelemetry API is imported here (no SDK), so this module is
 * safe to load anywhere; it returns `{}` until tracing is started.
 */
let projectId: string | undefined;

export function setTraceLogProject(value: string | undefined): void {
  projectId = value?.trim() || undefined;
}

export function traceLogFields(): Record<string, string | boolean> {
  if (!projectId) return {};
  const spanContext = trace.getSpan(context.active())?.spanContext();
  if (!spanContext || !trace.isSpanContextValid(spanContext)) return {};
  return {
    "logging.googleapis.com/trace": `projects/${projectId}/traces/${spanContext.traceId}`,
    "logging.googleapis.com/spanId": spanContext.spanId,
    "logging.googleapis.com/trace_sampled": (spanContext.traceFlags & 1) === 1,
  };
}
