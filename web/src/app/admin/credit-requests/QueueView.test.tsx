import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import CreditRequestsQueueView, {
  SELF_REQUEST_MESSAGE,
  formatBalance,
  getDismissConfirmMessage,
  getGrantConfirmMessage,
  reviewerIsRequester,
  shortenId,
} from "./QueueView";
import type { CreditRequest } from "../../../lib/api";

const pending: CreditRequest = {
  id: "req-1",
  userId: "0xa5360000000000000000000000000000000082cb",
  note: "Out of credits mid-session, need a few more tracks.",
  status: "pending",
  requestedAt: "2026-09-24T10:15:00.000Z",
  resolvedAt: null,
  resolvedBy: null,
  grantedCents: null,
  resolutionNote: null,
  balanceCents: 0,
};

const granted: CreditRequest = {
  ...pending,
  id: "req-2",
  status: "granted",
  resolvedAt: "2026-09-24T11:00:00.000Z",
  resolvedBy: "0xbeef00000000000000000000000000000000cafe",
  grantedCents: 500,
  resolutionNote: "Credit request top-up",
  balanceCents: 500,
};

const dismissed: CreditRequest = {
  ...pending,
  id: "req-3",
  status: "dismissed",
  note: null,
  resolvedAt: "2026-09-24T12:00:00.000Z",
  resolvedBy: "0xbeef00000000000000000000000000000000cafe",
  resolutionNote: "Duplicate request",
  balanceCents: 250,
};

function renderQueue(overrides: Partial<React.ComponentProps<typeof CreditRequestsQueueView>> = {}) {
  return renderToStaticMarkup(
    <CreditRequestsQueueView
      tab="pending"
      state={{ status: "ready", requests: [pending] }}
      reviewerUserId="0xoperator00000000000000000000000000000001"
      priceCentsPer30s={10}
      drafts={{}}
      errors={{}}
      inFlight={null}
      pendingGrant={null}
      pendingDismissal={null}
      successMessage={null}
      onTabChange={vi.fn()}
      onRetry={vi.fn()}
      onDraftChange={vi.fn()}
      onQuickGrant={vi.fn()}
      onRequestGrant={vi.fn()}
      onRequestDismiss={vi.fn()}
      onCancelGrant={vi.fn()}
      onConfirmGrant={vi.fn()}
      onCancelDismiss={vi.fn()}
      onConfirmDismiss={vi.fn()}
      {...overrides}
    />,
  );
}

describe("CreditRequestsQueueView", () => {
  it("renders the header and Pending/Resolved tabs", () => {
    const html = renderQueue();

    expect(html).toContain("Credit requests");
    expect(html).toContain("recorded in the credit ledger");
    expect(html).toContain('role="tablist"');
    expect(html).toMatch(/aria-selected="true"[^>]*>Pending</);
    expect(html).toMatch(/aria-selected="false"[^>]*>Resolved</);
  });

  it("shows the requester, note, time, balance, and grant controls for a pending request", () => {
    const html = renderQueue();

    expect(html).toContain("0xa536…82cb");
    expect(html).toContain(`title="${pending.userId}"`);
    expect(html).toContain("Copy");
    expect(html).toContain(pending.note);
    expect(html).toContain("Requested");
    expect(html).toContain("$0.00");
    expect(html).toContain(">Out of credits</span>");
    expect(html).toContain("Grant $1.00");
    expect(html).toContain("Grant $5.00");
    expect(html).toContain("Grant $10.00");
    expect(html).toContain("Custom amount (USD)");
    expect(html).toContain('value="Credit request top-up"');
    expect(html).toContain("Dismissal note (optional)");
    expect(html).toContain("Grant custom amount");
    expect(html).toContain("Dismiss request");
    expect(html).toContain("1 pending");
    expect(html).not.toContain('disabled=""');
  });

  it("shows the balance as dollars plus generation minutes", () => {
    expect(formatBalance(500, 10)).toBe("$5.00 · ≈ 25 min of generation");
    expect(formatBalance(500, null)).toBe("$5.00");
    const html = renderQueue({ state: { status: "ready", requests: [{ ...pending, balanceCents: 500 }] } });
    expect(html).toContain("$5.00 · ≈ 25 min of generation");
    expect(html).not.toContain(">Out of credits</span>");
  });

  it("disables every action and labels only the in-flight one while a decision is saving", () => {
    const other: CreditRequest = { ...pending, id: "req-9" };
    const html = renderQueue({
      state: { status: "ready", requests: [pending, other] },
      inFlight: { requestId: pending.id, action: "grant" },
    });

    expect(html).toContain("Granting…");
    expect(html).not.toContain("Dismissing…");
    expect(html.match(/Grant custom amount/g)).toHaveLength(1);
    // 3 quick grants + grant + dismiss per request.
    expect(html.match(/disabled=""/g)).toHaveLength(10);
  });

  it("locks every action on the operator's own request with a visible reason", () => {
    const html = renderQueue({ reviewerUserId: pending.userId.toUpperCase().replace(/^0X/, "0x") });

    expect(html).toContain(SELF_REQUEST_MESSAGE);
    expect(html).toContain(">Your request</span>");
    // Controls stay visible but honestly locked: 3 quick grants + grant + dismiss.
    expect(html.match(/aria-disabled="true"/g)).toHaveLength(5);
    expect(html.match(/aria-describedby="credit-request-locked-req-1"/g)).toHaveLength(8);
    expect(html).toContain("Grant $5.00");
    expect(html).toContain("Grant custom amount");
    expect(html).toContain("Dismiss request");
    // Inputs are disabled; buttons stay focusable so the reason is announced.
    expect(html.match(/disabled=""/g)).toHaveLength(3);
  });

  it("locks only the operator's own request when other requests are queued", () => {
    const other: CreditRequest = { ...pending, id: "req-9", userId: "0xfeed0000000000000000000000000000000000aa" };
    const html = renderQueue({
      reviewerUserId: pending.userId,
      state: { status: "ready", requests: [pending, other] },
    });

    expect(html.match(new RegExp(SELF_REQUEST_MESSAGE, "g"))).toHaveLength(1);
    expect(html.match(/aria-disabled="true"/g)).toHaveLength(5);
    expect(html).not.toContain("credit-request-locked-req-9");
  });

  it("does not lock requests from other users or when the reviewer is unknown", () => {
    expect(reviewerIsRequester("0xABC", "0xabc")).toBe(true);
    expect(reviewerIsRequester("0xabc", "0xdef")).toBe(false);
    expect(reviewerIsRequester(null, "0xabc")).toBe(false);
    expect(renderQueue()).not.toContain("aria-disabled");
    expect(renderQueue({ reviewerUserId: null })).not.toContain(SELF_REQUEST_MESSAGE);
  });

  it("shows a per-request validation error", () => {
    const html = renderQueue({ errors: { [pending.id]: "Enter an amount to grant." } });
    expect(html).toContain("Enter an amount to grant.");
    expect(html).toContain('aria-invalid="true"');
  });

  it("shows granted and dismissed badges and resolution details on the resolved tab", () => {
    const html = renderQueue({ tab: "resolved", state: { status: "ready", requests: [granted, dismissed] } });

    expect(html).toMatch(/aria-selected="true"[^>]*>Resolved</);
    expect(html).toContain("Granted $5.00");
    expect(html).toContain("Dismissed");
    expect(html).toContain("Resolved by");
    expect(html).toContain("0xbeef…cafe");
    expect(html).toContain("Credit request top-up");
    expect(html).toContain("Duplicate request");
    expect(html).toContain("No note from the requester.");
    expect(html).not.toContain("Grant $1.00");
    expect(html).not.toContain("Dismiss request");
  });

  it("shows loading, empty, error, and forbidden states", () => {
    const loading = renderQueue({ state: { status: "loading" } });
    const empty = renderQueue({ state: { status: "ready", requests: [] } });
    const emptyResolved = renderQueue({ tab: "resolved", state: { status: "ready", requests: [] } });
    const error = renderQueue({ state: { status: "error", message: "Service unavailable" } });
    const forbidden = renderQueue({ state: { status: "forbidden" } });

    expect(loading).toContain("Loading pending credit requests");
    expect(loading).not.toContain(pending.note);
    expect(empty).toContain("No pending credit requests");
    expect(empty).toContain("Refresh queue");
    expect(emptyResolved).toContain("No resolved credit requests");
    expect(error).toContain("Unable to load credit requests");
    expect(error).toContain("Service unavailable");
    expect(error).toContain("Try again");
    expect(forbidden).toContain("Only operators and administrators can review credit requests.");
    expect(forbidden).not.toContain('role="tablist"');
    expect(forbidden).not.toContain(pending.note);
  });

  it("shows a success banner after a decision", () => {
    const html = renderQueue({ successMessage: "Granted $5.00 of generation credits to 0xa536…82cb." });
    expect(html).toContain("Granted $5.00 of generation credits to 0xa536…82cb.");
  });
});

describe("credit request confirmations", () => {
  it("names the amount and the shortened requester in the grant confirmation", () => {
    const message = getGrantConfirmMessage({ request: pending, amountCents: 500, reason: "Credit request top-up" });
    expect(message.startsWith("Grant $5.00 of generation credits to 0xa536…82cb?")).toBe(true);
    expect(message).toContain("“Credit request top-up”");
    expect(message).toContain(pending.userId);
    expect(getGrantConfirmMessage({ request: pending, amountCents: 100, reason: "  " }))
      .toContain("The grant is recorded in the credit ledger.");
  });

  it("describes the dismissal and its optional note", () => {
    expect(getDismissConfirmMessage({ request: pending, note: "" })).toContain("No dismissal note will be recorded.");
    expect(getDismissConfirmMessage({ request: pending, note: "Duplicate" })).toContain("Dismissal note: “Duplicate”.");
  });

  it("shortens long ids and leaves short ones intact", () => {
    expect(shortenId(pending.userId)).toBe("0xa536…82cb");
    expect(shortenId("user-42")).toBe("user-42");
  });
});
