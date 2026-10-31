import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ADMIN_AUDIT_ACTION_OPTIONS,
  adminAuditActionLabel,
  adminAuditDetailSummary,
  adminAuditOutcomeLabel,
  isAdminAuditAction,
} from "./adminAudit";
import { API_BASE, buildAdminAuditQueryString, listAdminAuditEvents } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("admin audit helpers (#2173)", () => {
  it("labels every action the server writes and shows unknown ones as recorded", () => {
    for (const option of ADMIN_AUDIT_ACTION_OPTIONS) {
      expect(adminAuditActionLabel(option.value)).toBe(option.label);
      expect(isAdminAuditAction(option.value)).toBe(true);
    }
    expect(ADMIN_AUDIT_ACTION_OPTIONS).toHaveLength(88);
    expect(new Set(ADMIN_AUDIT_ACTION_OPTIONS.map((option) => option.value)).size).toBe(88);
    expect(adminAuditActionLabel("something.new")).toBe("something.new");
    expect(isAdminAuditAction("something.new")).toBe(false);
    expect(adminAuditOutcomeLabel("success")).toBe("Done");
    expect(adminAuditOutcomeLabel("denied")).toBe("Refused");
  });

  it("summarises detail from known keys only", () => {
    expect(adminAuditDetailSummary({ action: "account.closed", detail: { reason: "fraud", note: "never", scheduleErasure: true } }))
      .toBe("Fraud");
    expect(adminAuditDetailSummary({ action: "admin.step_up_refused", detail: { reason: "signature_mismatch" } }))
      .toBe("the signature did not match");
    expect(adminAuditDetailSummary({ action: "notice.targeted_sent", detail: { category: "account", recipientCount: 1 } }))
      .toBe("account · 1 person");
    expect(adminAuditDetailSummary({ action: "notice.broadcast_sent", detail: { noticeId: "12345678-aaaa", category: "policy", audience: "all" } }))
      .toBe("policy · to all · notice 12345678");
    expect(adminAuditDetailSummary({ action: "agent_session.events_viewed", detail: { sessionId: "s-1", eventCount: 12 } }))
      .toBe("12 events · session s-1");
    expect(adminAuditDetailSummary({ action: "credit_request.granted", detail: { requestId: "r-1", amountCents: 750 } }))
      .toBe("$7.50");
    expect(adminAuditDetailSummary({ action: "dmca.report_resolved", detail: { reportId: "r-1", outcome: "upheld" } }))
      .toBe("upheld");
    expect(adminAuditDetailSummary({ action: "management_recovery.reviewed", detail: { recoveryId: "x", decision: "approve" } }))
      .toBe("approve");
    expect(adminAuditDetailSummary({ action: "community_moderation.report_resolved", detail: { action: "ban_member" } }))
      .toBe("ban member");
    // #2380: branch codes read as plain words; addresses and ids are not repeated.
    expect(adminAuditDetailSummary({ action: "show_pledge.operator_acted", detail: { pledgeId: "p-1", via: "refund_confirm" } }))
      .toBe("refund confirm");
    expect(adminAuditDetailSummary({ action: "wallet.support_changed", detail: { change: "fund" } })).toBe("fund");
    expect(adminAuditDetailSummary({ action: "rights_evidence.privileged_submitted", detail: { evidenceRole: "trusted_source", subjectId: "r-1" } }))
      .toBe("trusted source");
    // #2497: the billing report records the month and, for a download, the format and section.
    expect(adminAuditActionLabel("billing.reconciliation_viewed")).toBe("Opened the billing reconciliation report");
    expect(adminAuditDetailSummary({ action: "billing.reconciliation_viewed", detail: { month: "2026-09" } }))
      .toBe("2026-09");
    expect(adminAuditDetailSummary({
      action: "billing.reconciliation_viewed",
      detail: { month: "2026-09", format: "csv", section: "needs_review" },
    })).toBe("2026-09 · CSV · needs review");
    expect(adminAuditDetailSummary({ action: "user.detail_viewed", detail: null })).toBeNull();
  });

  it("builds the query without empty filters and calls the admin-only route", async () => {
    expect(buildAdminAuditQueryString({})).toBe("");
    expect(buildAdminAuditQueryString({ action: "account.closed", outcome: "denied", page: 2, pageSize: 50 }))
      .toBe("?action=account.closed&outcome=denied&page=2&pageSize=50");

    vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [], page: 1, pageSize: 50, total: 0 }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await listAdminAuditEvents("session-token", { outcome: "denied" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API_BASE}/admin/audit-events?outcome=denied`);
    expect(init.cache).toBe("no-store");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer session-token");
  });
});
