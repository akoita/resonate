import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import AuditLogView, { type AuditLogViewProps } from "./AuditLogView";

const EVENT = {
  id: "e-1",
  createdAt: "2026-10-24T12:05:00.000Z",
  actorUserId: "0xabcdef0000000000000000000000000000000001",
  action: "account.closed",
  targetUserId: "0x1234560000000000000000000000000000000002",
  outcome: "success",
  detail: { reason: "fraud" },
};

function render(overrides: Partial<AuditLogViewProps> = {}) {
  return renderToStaticMarkup(
    <AuditLogView
      allowed
      state={{ status: "ready", page: { items: [EVENT], page: 1, pageSize: 50, total: 1 } }}
      filters={{ page: 1 }}
      onFiltersChange={vi.fn()}
      onRetry={vi.fn()}
      {...overrides}
    />,
  );
}

describe("AuditLogView (#2173)", () => {
  it("lists entries with who, what, about, outcome and detail, and says the log is append-only", () => {
    const html = render();
    expect(html).toContain("<h1>Admin audit log</h1>");
    expect(html).toContain("Closed an account");
    expect(html).toContain("0xabcd...0001");
    expect(html).toContain("0x1234...0002");
    expect(html).toContain("24 Oct 2026, 12:05 UTC");
    expect(html).toContain("Done");
    expect(html).toContain("Fraud");
    expect(html).toContain("append-only");
    expect(html).toContain("Showing 1-1 of 1");
  });

  it("shows a refused confirmation as refused", () => {
    const html = render({
      state: {
        status: "ready",
        page: {
          items: [{ ...EVENT, action: "admin.step_up_refused", outcome: "denied", targetUserId: null, detail: { reason: "signature_mismatch" } }],
          page: 1,
          pageSize: 50,
          total: 1,
        },
      },
    });
    expect(html).toContain("Passkey confirmation refused");
    expect(html).toContain("Refused");
    expect(html).toContain("the signature did not match");
  });

  it("offers filters for every action and outcome", () => {
    const html = render();
    expect(html).toContain('aria-label="What happened"');
    expect(html).toContain("Sent a broadcast notice");
    expect(html).toContain("Confirmed with a passkey");
    expect(html).toContain('aria-label="Outcome"');
  });

  it("has loading, empty and error states", () => {
    expect(render({ state: { status: "loading" } })).toContain("Loading the audit log");
    expect(render({ state: { status: "ready", page: { items: [], page: 1, pageSize: 50, total: 0 } } })).toContain("Nothing logged yet");
    const error = render({ state: { status: "error", message: "Boom" } });
    expect(error).toContain("Could not load the audit log");
    expect(error).toContain("Try again");
  });

  it("denies anyone who is not an admin, with no data", () => {
    const html = render({ allowed: false });
    expect(html).toContain("Admins only");
    expect(html).not.toContain("<table");
  });
});
