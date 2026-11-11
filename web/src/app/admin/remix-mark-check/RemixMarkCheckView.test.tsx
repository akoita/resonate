import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { RemixWatermarkDetection } from "../../../lib/api";
import { formatRightsEvidenceKindLabel } from "../../../lib/rightsEvidence";
import RemixMarkCheckView, {
  REMIX_MARK_CAVEAT,
  isRemixMarkCheckRunning,
  type RemixMarkCheckViewProps,
} from "./RemixMarkCheckView";

const BASE: RemixWatermarkDetection = {
  id: "det-1",
  status: "no_match",
  clipSha256: "a".repeat(64),
  clipBytes: 1000,
  candidatesDecoded: 8,
  failureCode: null,
  createdAt: "2026-11-11T12:05:00.000Z",
  completedAt: "2026-11-11T12:05:04.000Z",
  evidenceId: null,
  caveat: REMIX_MARK_CAVEAT,
  match: null,
};

const MATCHED: RemixWatermarkDetection = {
  ...BASE,
  status: "matched",
  match: {
    keyId: "k1",
    keySlot: "retired",
    stage: "speed",
    decodeError: 0.05,
    syncQuality: 2.1,
    occurrences: 3,
    render: {
      id: "wm-1",
      remixProjectId: "project-1",
      generationJobId: "gen-1",
      renderJobId: "render-1",
      ownerUserId: "0xabc",
      sourceTrackId: "track-1",
      secondarySourceTrackId: null,
      stemIds: ["stem-1"],
      stemLicenses: [{ stemId: "stem-1", basis: "remix", stemPurchaseIds: ["purchase-1"], x402SettlementIds: [] }],
      renderedStemIndexes: [],
      policyVersion: "remix-eligibility/v1",
      scheme: "audiowmark",
      schemeVersion: "0.6.5",
      renderedAt: "2026-11-10T09:00:00.000Z",
    },
  },
};

function render(overrides: Partial<RemixMarkCheckViewProps> = {}) {
  return renderToStaticMarkup(
    <RemixMarkCheckView
      allowed
      configured
      current={null}
      recent={[]}
      busy={false}
      error={null}
      attachError={null}
      onCheck={vi.fn()}
      onOpen={vi.fn()}
      onAttach={vi.fn()}
      {...overrides}
    />,
  );
}

describe("RemixMarkCheckView (#2575)", () => {
  it("is for admins only", () => {
    const html = render({ allowed: false });
    expect(html).toContain("Only admins");
    expect(html).not.toContain("Check clip");
  });

  it("always says what a match means, before any check", () => {
    const html = render();
    expect(html).toContain("does not show who uploaded or shared it elsewhere");
    expect(html).toContain("Check clip");
  });

  it("says so when marking is not switched on, and offers no upload", () => {
    const html = render({ configured: false });
    expect(html).toContain("not switched on");
    expect(html).not.toContain("Check clip");
  });

  it("shows the matched render, its licence trail and the attach form", () => {
    const html = render({ current: MATCHED });
    expect(html).toContain("Result: Match");
    expect(html).toContain("project-1");
    expect(html).toContain("gen-1");
    expect(html).toContain("the retired key, after a speed search");
    expect(html).toContain("stem-1: remix licence (purchase-1)");
    expect(html).toContain('href="/admin/users/0xabc"');
    expect(html).toContain("Attach as evidence");
  });

  it("replaces the attach form once the match is attached", () => {
    const html = render({ current: { ...MATCHED, evidenceId: "ev-1" } });
    expect(html).toContain("Attached as evidence.");
    expect(html).not.toContain("Its id");
  });

  it("does not present no match as proof", () => {
    const html = render({ current: BASE });
    expect(html).toContain("Result: No match");
    expect(html).toContain("does not prove");
    expect(html).not.toContain("Attach as evidence");
  });

  it("explains a failed check and a running one", () => {
    expect(render({ current: { ...BASE, status: "failed", failureCode: "decode_failed" } })).toContain(
      "could not be read as audio",
    );
    const running = { ...BASE, status: "processing" as const };
    expect(isRemixMarkCheckRunning(running)).toBe(true);
    expect(isRemixMarkCheckRunning(MATCHED)).toBe(false);
    expect(render({ current: running })).toContain("Checking…");
  });

  it("lists recent checks", () => {
    const html = render({ recent: [MATCHED, BASE] });
    expect(html).toContain("Recent checks");
    expect(html).toContain("11 Nov 2026, 12:05 UTC");
  });

  it("labels the evidence kind for the dispute screens", () => {
    expect(formatRightsEvidenceKindLabel("remix_watermark_match")).toBe("Remix mark match");
  });
});
