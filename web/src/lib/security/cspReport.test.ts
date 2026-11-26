import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { createReportBudget, MAX_REPORTS_PER_REQUEST, parseCspReports, safeLocation } from "./cspReport";

const require = createRequire(import.meta.url);
const { securityHeaders, reportOnlyContentSecurityPolicy } = require("../build/securityHeaders.cjs") as {
  securityHeaders: (env: Record<string, string | undefined>) => Array<{ key: string; value: string }>;
  reportOnlyContentSecurityPolicy: (env: Record<string, string | undefined>) => string;
};

describe("security headers", () => {
  it("enforces framing, sniffing and transport protections", () => {
    const headers = Object.fromEntries(securityHeaders({}).map(({ key, value }) => [key, value]));
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Strict-Transport-Security"]).toMatch(/max-age=\d+/);
    expect(headers["Strict-Transport-Security"]).not.toContain("preload");
  });

  it("keeps the script policy report-only and allows the API origin", () => {
    const policy = reportOnlyContentSecurityPolicy({ NEXT_PUBLIC_API_URL: "https://api.example.test/v1" });
    expect(policy).toContain("connect-src 'self' https://api.example.test wss://api.example.test");
    expect(policy).toContain("media-src 'self' blob: data: https://api.example.test");
    expect(policy).toContain("report-uri /api/security/csp-report");
    expect(policy).not.toContain("'unsafe-eval'");
  });

  it("allows eval only in development", () => {
    expect(reportOnlyContentSecurityPolicy({ NODE_ENV: "development" })).toContain("'unsafe-eval'");
  });
});

describe("CSP report parsing", () => {
  it("reads the legacy report-uri shape and strips query strings", () => {
    const [violation] = parseCspReports({
      "csp-report": {
        "document-uri": "https://app.example.test/player?token=secret",
        "blocked-uri": "https://cdn.example.test/x.js?sig=abc",
        "violated-directive": "script-src-elem 'self'",
        "line-number": 12,
      },
    });
    expect(violation).toMatchObject({
      documentPath: "/player",
      blocked: "https://cdn.example.test/x.js",
      directive: "script-src-elem",
      line: 12,
    });
    expect(JSON.stringify(violation)).not.toContain("secret");
  });

  it("reads the Reporting API shape and ignores other report types", () => {
    const violations = parseCspReports([
      { type: "csp-violation", body: { documentURL: "https://app.example.test/", blockedURL: "inline", effectiveDirective: "script-src-elem" } },
      { type: "deprecation", body: { id: "x" } },
    ]);
    expect(violations).toEqual([
      expect.objectContaining({ documentPath: "/", blocked: "inline", directive: "script-src-elem" }),
    ]);
  });

  it("bounds the number of reports and ignores junk", () => {
    const many = Array.from({ length: 50 }, () => ({ type: "csp-violation", body: {} }));
    expect(parseCspReports(many)).toHaveLength(MAX_REPORTS_PER_REQUEST);
    expect(parseCspReports("nope")).toEqual([]);
    expect(parseCspReports({ other: 1 })).toEqual([]);
  });

  it("never logs a javascript: or data: payload", () => {
    expect(safeLocation("javascript:alert(document.cookie)")).toBe("javascript");
    expect(safeLocation("data:text/html;base64,AAAA")).toBe("data");
  });
});

describe("report budget", () => {
  it("caps reports per window and refills after it", () => {
    let clock = 0;
    const budget = createReportBudget(3, 1000, () => clock);
    expect(budget.take(2)).toBe(2);
    expect(budget.take(5)).toBe(1);
    expect(budget.take(1)).toBe(0);
    clock = 1000;
    expect(budget.take(1)).toBe(1);
  });
});
