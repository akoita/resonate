import { BUILD_VERSION } from "../../../../lib/buildVersion";
import { parseBrowserErrorReport } from "../../../../lib/monitoring/browserErrors";
import { createReportBudget } from "../../../../lib/security/cspReport";

// Receives browser error reports from src/instrumentation-client.ts and logs
// each one in the shape Cloud Error Reporting groups automatically: the
// `@type` marks it as an error event, `message` carries the stack, and
// `serviceContext` names the service and build. Browser errors show up in
// Error Reporting as the `resonate-web-browser` service.
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 8 * 1024;
const budget = createReportBudget(120, 60_000);
const REPORTED_ERROR_EVENT = "type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent";

export async function POST(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_BODY_BYTES) return new Response(null, { status: 413 });
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return new Response(null, { status: 413 });

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response(null, { status: 400 });
  }
  const report = parseBrowserErrorReport(payload);
  if (!report) return new Response(null, { status: 400 });
  if (budget.take(1) === 0) return new Response(null, { status: 204 });

  const headline = `${report.name}: ${report.message}`;
  console.log(
    JSON.stringify({
      severity: "ERROR",
      "@type": REPORTED_ERROR_EVENT,
      event: "browser.error",
      // Error Reporting parses the stack from the message; a bare message
      // without one falls back to `context.reportLocation`.
      message: report.stack && report.stack.includes(report.message) ? report.stack : `${headline}\n${report.stack ?? ""}`.trim(),
      serviceContext: { service: "resonate-web-browser", version: BUILD_VERSION || "unknown" },
      context: {
        httpRequest: { url: report.path, userAgent: (request.headers.get("user-agent") ?? "").slice(0, 200) },
        reportLocation: {
          filePath: report.source || "unknown",
          lineNumber: report.line ?? 0,
          functionName: report.kind,
        },
      },
      kind: report.kind,
      path: report.path,
    }),
  );
  return new Response(null, { status: 204 });
}
