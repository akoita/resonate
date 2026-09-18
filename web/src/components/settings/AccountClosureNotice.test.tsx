/**
 * #1771 — the standing notice that an account is going to be deleted.
 *
 * Rendered statically (the suite has no DOM), because what matters here is the
 * copy and the way out: the person this banner is written for may be seeing a
 * deletion somebody else asked for.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AccountClosureBanner } from "./AccountClosureNotice";
import { formatClosureDate } from "./AccountClosurePanel";

const DUE_AT = "2026-10-18T10:00:00.000Z";

describe("account deletion notice (#1771)", () => {
  it("names the date, the days left, and offers the way out in one click", () => {
    const html = renderToStaticMarkup(
      <AccountClosureBanner
        dueAt={DUE_AT}
        cancelling={false}
        onCancel={() => {}}
        now={new Date("2026-10-11T10:00:00.000Z")}
      />,
    );

    expect(html).toContain("scheduled for deletion");
    expect(html).toContain(formatClosureDate(DUE_AT));
    expect(html).toContain("in 7 days");
    expect(html).toContain("Cancel deletion");
    expect(html).toContain("Signing in also cancels it");
  });

  it("speaks to the person who did not ask for this", () => {
    const html = renderToStaticMarkup(
      <AccountClosureBanner dueAt={DUE_AT} cancelling={false} onCancel={() => {}} />,
    );

    expect(html).toContain("If you did not ask for this, cancel it now");
    // No dismiss control: this cannot be waved away and then forgotten for
    // thirty days.
    expect(html.toLowerCase()).not.toContain("dismiss");
    expect(html.toLowerCase()).not.toContain("not now");
  });

  it("holds the cancel action while it is in flight", () => {
    const html = renderToStaticMarkup(
      <AccountClosureBanner dueAt={DUE_AT} cancelling onCancel={() => {}} />,
    );

    expect(html).toContain("Cancelling...");
    expect(html).toContain("disabled");
  });

  it("is a labelled region, not a dialog: it never traps anyone in the app", () => {
    const html = renderToStaticMarkup(
      <AccountClosureBanner dueAt={DUE_AT} cancelling={false} onCancel={() => {}} />,
    );

    expect(html).toContain('role="region"');
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain("aria-modal");
  });
});
