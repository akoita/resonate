import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnalyticsConsentBanner } from "./AnalyticsConsentPrompt";

function render(overrides: Partial<React.ComponentProps<typeof AnalyticsConsentBanner>> = {}) {
  return renderToStaticMarkup(
    <AnalyticsConsentBanner
      textChanged={false}
      submitting={null}
      onDecide={() => {}}
      {...overrides}
    />,
  );
}

describe("analytics consent prompt (#1772)", () => {
  it("gives refusing and accepting the same prominence", () => {
    const html = render();
    const buttons = html.match(/<button[^>]*class="([^"]*)"[^>]*>/g) ?? [];

    expect(buttons).toHaveLength(2);
    const classes = buttons.map((button) => button.match(/class="([^"]*)"/)?.[1]);
    // Same classes means same size and same weight. A ghost button or a link
    // on the refusal side would be a dark pattern, not a style choice.
    expect(new Set(classes).size).toBe(1);
    expect(classes[0]).toContain("ui-btn-primary");
  });

  it("offers both answers and preselects neither", () => {
    const html = render();

    expect(html).toContain("No, do not measure");
    expect(html).toContain("Yes, measure my use");
    expect(html).not.toContain("checked");
    expect(html).not.toContain("defaultChecked");
  });

  it("can only be dismissed by deciding — no escape hatch", () => {
    const html = render();

    // The only two controls are the two answers: no close control, no "ask me
    // later", nothing that leaves the question unanswered.
    expect(html.match(/<button/g) ?? []).toHaveLength(2);
    expect(html.toLowerCase()).not.toContain("not now");
    expect(html.toLowerCase()).not.toContain("ask me later");
    expect(html.toLowerCase()).not.toContain("dismiss");
    expect(html.toLowerCase()).not.toContain("aria-label=\"close");
  });

  it("is a persistent labelled region, not a modal that holds the app hostage", () => {
    const html = render();

    // Replaces the earlier modal-semantics assertion: a blocking overlay
    // contradicts the copy's promise that refusing is free, and would
    // interrupt every session at once after a consent-text change.
    expect(html).toContain('role="region"');
    expect(html).toContain('aria-labelledby="analytics-consent-title"');
    expect(html).not.toContain("aria-modal");
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain("analytics-consent-overlay");
  });

  it("explains both the free choice and the honest product tradeoff", () => {
    const html = render();

    expect(html).toContain("entirely optional");
    expect(html).toContain("does not disable any feature");
    expect(html).toContain("less tailored or complete");
    expect(html).toContain("/help/product-analytics");
  });

  it("explains the re-ask when the consent text has changed", () => {
    expect(render({ textChanged: true })).toContain("has changed since you were last asked");
    expect(render({ textChanged: false })).not.toContain("has changed since you were last asked");
  });

  it("disables both answers while one is saving", () => {
    const html = render({ submitting: "granted" });

    expect(html.match(/disabled/g) ?? []).toHaveLength(2);
    expect(html).toContain("Saving...");
  });
});
