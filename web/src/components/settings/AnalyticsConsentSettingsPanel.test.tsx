/**
 * #2231 / #2230: every state of Settings → Privacy → Usage measurement,
 * rendered statically (the unit suite has no DOM).
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AnalyticsConsentState } from "../../lib/analyticsConsent";
import {
  AnalyticsConsentSettingsView,
  selectedConsentChoice,
} from "./AnalyticsConsentSettingsPanel";

const base: AnalyticsConsentState = {
  known: true,
  decided: true,
  productAnalytics: true,
  needsDecision: false,
  currentPolicyVersion: "v1",
  checkFailed: false,
};

function render(consent: Partial<AnalyticsConsentState> = {}) {
  return renderToStaticMarkup(
    <AnalyticsConsentSettingsView
      consent={{ ...base, ...consent }}
      loading={false}
      saving={null}
      canAct
      onRefresh={() => {}}
      onDecide={() => {}}
    />,
  );
}

function buttonFor(html: string, label: string) {
  const match = html.match(new RegExp(`<button[^>]*analytics-consent-action[^>]*>${label}</button>`));
  expect(match, `button "${label}"`).not.toBeNull();
  return match![0];
}

describe("usage measurement settings: selected choice (#2231)", () => {
  it("marks 'Measure my use' with a recorded grant", () => {
    const html = render();
    expect(buttonFor(html, "Measure my use")).toContain('aria-pressed="true"');
    expect(buttonFor(html, "Do not measure")).toContain('aria-pressed="false"');
  });

  it("marks 'Do not measure' with a recorded refusal", () => {
    const html = render({ productAnalytics: false });
    expect(buttonFor(html, "Do not measure")).toContain('aria-pressed="true"');
    expect(buttonFor(html, "Measure my use")).toContain('aria-pressed="false"');
  });

  it("marks neither before a decision", () => {
    const html = render({ decided: false, productAnalytics: false, needsDecision: true });
    expect(buttonFor(html, "Do not measure")).toContain('aria-pressed="false"');
    expect(buttonFor(html, "Measure my use")).toContain('aria-pressed="false"');
    expect(html).toContain("Not chosen yet");
  });

  it("marks neither while the decision is unknown", () => {
    expect(selectedConsentChoice({ ...base, known: false })).toBeNull();
    const html = render({ known: false, decided: false, productAnalytics: false });
    expect(html).not.toContain('aria-pressed="true"');
  });

  it("keeps both buttons identical in class, so selection never promotes one", () => {
    for (const consent of [{}, { productAnalytics: false }, { decided: false }]) {
      const html = render(consent);
      const classes = (html.match(/<button[^>]*analytics-consent-action[^>]*>/g) ?? []).map(
        (button) => button.match(/class="([^"]*)"/)?.[1],
      );
      expect(classes).toHaveLength(2);
      expect(new Set(classes).size).toBe(1);
    }
  });
});

describe("usage measurement settings: unreachable decision (#2230)", () => {
  it("says nothing is being recorded once the check has kept failing", () => {
    const html = render({ known: false, decided: false, productAnalytics: false, checkFailed: true });
    expect(html).toContain("We couldn&#x27;t check your choice; nothing is being recorded right now");
    expect(html).toContain("Could not be checked");
  });

  it("stays quiet while the first check is simply in progress", () => {
    const html = render({ known: false, decided: false, productAnalytics: false });
    expect(html).not.toContain("couldn&#x27;t check");
    expect(html).toContain("Checking...");
  });
});
