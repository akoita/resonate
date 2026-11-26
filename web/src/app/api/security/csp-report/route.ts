import { createReportBudget, parseCspReports } from "../../../../lib/security/cspReport";

// Receives the browser's Content-Security-Policy reports (see
// src/lib/build/securityHeaders.cjs) and writes each one as a single JSON
// line. On Cloud Run a JSON line on stdout becomes a structured Cloud Logging
// entry, so violations can be searched with `jsonPayload.event="security.csp_violation"`.
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 16 * 1024;
const budget = createReportBudget(120, 60_000);

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

  const violations = parseCspReports(payload);
  const granted = budget.take(violations.length);
  for (const violation of violations.slice(0, granted)) {
    console.log(
      JSON.stringify({
        severity: "WARNING",
        event: "security.csp_violation",
        message: `CSP ${violation.disposition}: ${violation.directive} blocked ${violation.blocked || "unknown"}`,
        ...violation,
      }),
    );
  }

  return new Response(null, { status: 204 });
}
