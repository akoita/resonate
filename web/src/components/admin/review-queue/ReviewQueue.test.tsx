import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ReviewDecisionFooter, ReviewQueueStatePanel, formatRequestedAt, oldestCreatedAt } from "./ReviewQueue";

describe("review queue helpers", () => {
  it("formats request times as relative and absolute labels", () => {
    const now = Date.parse("2026-09-21T10:15:00.000Z");

    expect(formatRequestedAt("2026-09-20T10:15:00.000Z", now)?.relative).toBe("1 day ago");
    expect(formatRequestedAt("2026-09-21T10:14:30.000Z", now)?.relative).toBe("just now");
    expect(formatRequestedAt("not-a-date", now)).toBeNull();
  });

  it("finds the oldest valid request time", () => {
    const now = Date.parse("2026-09-21T10:15:00.000Z");
    const oldest = oldestCreatedAt([
      { createdAt: "2026-09-21T08:15:00.000Z" },
      { createdAt: "invalid" },
      { createdAt: "2026-09-19T10:15:00.000Z" },
    ], now);

    expect(oldest?.iso).toBe("2026-09-19T10:15:00.000Z");
    expect(oldest?.relative).toBe("2 days ago");
    expect(oldestCreatedAt([{ createdAt: "invalid" }])).toBeNull();
  });
});

describe("review queue components", () => {
  it("announces forbidden and error panels as alerts but not the empty panel", () => {
    const error = renderToStaticMarkup(
      <ReviewQueueStatePanel variant="error" heading="Unable" body="Down" actionLabel="Try again" onAction={vi.fn()} />,
    );
    const empty = renderToStaticMarkup(
      <ReviewQueueStatePanel variant="empty" heading="Nothing" body="Empty" actionLabel="Refresh queue" onAction={vi.fn()} />,
    );

    expect(error).toContain('role="alert"');
    expect(error).toContain("Try again");
    expect(empty).not.toContain('role="alert"');
    expect(empty).toContain("Refresh queue");
  });

  it("renders only the self-review notice when the reviewer cannot decide", () => {
    const props = {
      idPrefix: "item",
      itemId: "1",
      note: "",
      onNoteChange: vi.fn(),
      approveLabel: "Approve item",
      rejectLabel: "Reject item",
      inFlightDecision: null,
      disabled: false,
      onApprove: vi.fn(),
      onReject: vi.fn(),
    };
    const blocked = renderToStaticMarkup(<ReviewDecisionFooter {...props} selfReviewMessage="Someone else must review." />);
    const open = renderToStaticMarkup(<ReviewDecisionFooter {...props} note="ok" />);

    expect(blocked).toContain("Someone else must review.");
    expect(blocked).not.toContain("<textarea");
    expect(blocked).not.toContain("Approve item");
    expect(open).toContain('id="item-review-note-1"');
    expect(open).toContain("2 / 4000");
    expect(open).toContain("Approve item");
    expect(open).toContain("Reject item");
  });
});
