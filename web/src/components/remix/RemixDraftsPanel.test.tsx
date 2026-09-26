import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  draftProvenanceChip,
  formatCompletedAt,
  gatedClickHandler,
  RemixDraftsPanel,
  type RemixCurrentDraft,
  type RemixDraftsPanelProps,
  type RemixDraftVersion,
} from "./RemixDraftsPanel";

const noop = () => undefined;

/** The opening tag of the first button carrying `className`. */
function buttonTag(html: string, className: string): string {
  const match = html.match(new RegExp(`<button[^>]*${className}[^>]*>`));
  return match?.[0] ?? "";
}
const NOW = Date.parse("2026-09-25T12:00:00Z");
const JOB_CURRENT = "job-7f3a9c2e-current";
const JOB_V1 = "job-11aa22bb-previous";
const JOB_V2 = "job-33cc44dd-older";

function draft(overrides: Partial<RemixCurrentDraft> = {}): RemixCurrentDraft {
  return {
    status: "completed",
    failureMessage: null,
    kindLabel: "Stem mix render",
    provenance: "stem_audio",
    groundingDetail: "High-fidelity stem render: the draft contains the licensed source audio.",
    transformNote: null,
    costUsd: 0,
    completedAt: new Date(NOW - 5 * 60_000).toISOString(),
    peaks: [0.1, 0.6, 0.9, 0.3],
    playing: false,
    loading: false,
    ...overrides,
  };
}

function version(overrides: Partial<RemixDraftVersion> = {}): RemixDraftVersion {
  return {
    jobId: JOB_V1,
    label: "AI layer added",
    provenance: "stem_plus_ai",
    costUsd: 0.2,
    completedAt: new Date(NOW - 2 * 3600_000).toISOString(),
    peaks: [0.4, 0.5],
    playing: false,
    loading: false,
    ...overrides,
  };
}

function props(overrides: Partial<RemixDraftsPanelProps> = {}): RemixDraftsPanelProps {
  return {
    current: draft(),
    versions: [],
    onPlayCurrent: noop,
    onPlayVersion: noop,
    publish: {
      enabled: true,
      reason: null,
      busy: false,
      reasonCode: "publish_available",
      onClick: noop,
      onLockedClick: noop,
    },
    exportAction: {
      enabled: true,
      reason: null,
      busy: false,
      onClick: noop,
      onLockedClick: noop,
    },
    published: false,
    emptyHint: "No draft yet — render your mix or generate with AI.",
    now: NOW,
    ...overrides,
  };
}

function render(overrides: Partial<RemixDraftsPanelProps> = {}): string {
  return renderToStaticMarkup(<RemixDraftsPanel {...props(overrides)} />);
}

describe("RemixDraftsPanel — current draft", () => {
  it("shows the empty hint without a draft", () => {
    const html = render({ current: null });
    expect(html).toContain("No draft yet — render your mix or generate with AI.");
    expect(html).not.toContain("remix-draft-playback-btn");
  });

  it("renders a queued draft as in progress without playback or provenance", () => {
    const html = render({ current: draft({ status: "queued", kindLabel: "AI draft" }) });
    expect(html).toContain('role="status"');
    expect(html).toContain("In progress");
    expect(html).toContain("AI draft");
    expect(html).not.toContain("remix-draft-playback-btn");
    expect(html).not.toContain("remix-provenance-chip");
  });

  it("renders a failure with its message and points to the Create button", () => {
    const html = render({
      current: draft({
        status: "failed",
        failureMessage: "The provider rejected this prompt. Adjust it and try again.",
      }),
    });
    expect(html).toContain("The provider rejected this prompt. Adjust it and try again.");
    expect(html).toContain("Retry from the Create panel.");
    expect(html).not.toContain("remix-draft-playback-btn");
  });

  it("falls back to a generic failure message", () => {
    const html = render({ current: draft({ status: "failed", failureMessage: null }) });
    expect(html).toContain("Generation failed. Please try again later.");
  });

  it("renders a completed draft with chip, detail, time, waveform and play", () => {
    const html = render({
      current: draft({
        kindLabel: "AI Drums replacement",
        provenance: "audio_conditioned",
        transformNote: "AI Drums replacement — generated to take the Drums's place.",
        costUsd: 0.4,
      }),
    });
    expect(html).toContain("AI Drums replacement");
    expect(html).toContain("AI · heard your stems");
    expect(html).toContain("remix-provenance-chip--ai");
    expect(html).toContain("<details");
    expect(html).toContain("High-fidelity stem render");
    expect(html).toContain("generated to take the Drums");
    expect(html).toContain("~$0.40");
    expect(html).toContain("5 min ago");
    expect(html).toContain("remix-draft-waveform");
    expect(html).toMatch(/aria-label="Play draft"[^>]*>Play<\/button>/);
  });

  it("hides a zero cost and the waveform without peaks", () => {
    const html = render({ current: draft({ costUsd: 0, peaks: null }) });
    expect(html).not.toContain("~$");
    expect(html).not.toContain("remix-draft-waveform");
    expect(html).toContain("Your stems only");
    expect(html).toContain("remix-provenance-chip--stems");
  });

  it("shows stop and loading playback states", () => {
    expect(render({ current: draft({ playing: true }) })).toMatch(
      /aria-label="Stop draft"[^>]*>Stop<\/button>/,
    );
    expect(render({ current: draft({ loading: true }) })).toContain("Loading…");
  });

  it("renders no_output honestly without a play button", () => {
    const html = render({ current: draft({ status: "no_output" }) });
    expect(html).toContain("This draft has no playable output yet.");
    expect(html).not.toContain("remix-draft-playback-btn");
    expect(html).toContain("Your stems only");
  });
});

describe("RemixDraftsPanel — publish and export", () => {
  it("renders enabled publish and export", () => {
    const html = render();
    expect(html).toMatch(/<button[^>]*remix-action-publish[^>]*>Publish on Resonate<\/button>/);
    expect(buttonTag(html, "remix-action-publish")).not.toContain("aria-disabled");
    expect(html).toMatch(/<button[^>]*remix-action-export[^>]*>Export audio<\/button>/);
  });

  it("hides publish and export until a draft exists", () => {
    const html = render({ current: null });
    expect(html).not.toContain("remix-action-publish");
    expect(html).not.toContain("Export audio");
  });

  it("marks unavailable publish aria-disabled with its visible reason", () => {
    const reason = "Render or generate a draft and wait for it to finish before publishing.";
    const html = render({
      current: draft({ status: "queued", kindLabel: "AI draft" }),
      publish: {
        enabled: false,
        reason,
        busy: false,
        reasonCode: "publish_needs_completed_draft",
        onClick: noop,
        onLockedClick: noop,
      },
    });
    expect(buttonTag(html, "remix-action-publish")).toContain('aria-disabled="true"');
    expect(html).toContain(reason);
    expect(html).toContain('data-reason-code="publish_needs_completed_draft"');
  });

  it("keeps locked export honest: aria-disabled with an sr-only reason", () => {
    const reason = "Export requires a commercial license on the source stems.";
    const html = render({
      exportAction: {
        enabled: false,
        reason,
        busy: false,
        onClick: noop,
        onLockedClick: noop,
      },
    });
    expect(html).toMatch(
      /aria-disabled="true"[^>]*remix-action-unavailable--export[^>]*>Export audio<span class="sr-only"> — Export requires a commercial license/,
    );
    expect(html).not.toMatch(/<button[^>]*disabled=""/);
  });

  it("routes unavailable clicks to onLockedClick and never runs the action", () => {
    const onClick = vi.fn();
    const onLockedClick = vi.fn();
    const preventDefault = vi.fn();
    gatedClickHandler({ enabled: false, onClick, onLockedClick })({ preventDefault });
    expect(onClick).not.toHaveBeenCalled();
    expect(onLockedClick).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    gatedClickHandler({ enabled: true, onClick, onLockedClick })({ preventDefault });
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onLockedClick).toHaveBeenCalledTimes(1);
  });

  it("shows busy labels", () => {
    const html = render({
      publish: { ...props().publish, busy: true, enabled: false, reason: null },
      exportAction: { ...props().exportAction, busy: true },
    });
    expect(html).toContain("Publishing...");
    expect(html).toContain("Exporting...");
  });

  it("renders publish and export as a compact row in the draft card footer", () => {
    const html = render();
    const card = html.indexOf("remix-current-draft ");
    const waveform = html.indexOf("remix-draft-waveform");
    const actions = html.indexOf("remix-draft-actions");
    expect(card).toBeGreaterThan(-1);
    expect(actions).toBeGreaterThan(waveform);
    expect(buttonTag(html, "remix-action-publish")).toContain("ui-btn-sm");
    expect(buttonTag(html, "remix-action-export")).toContain("ui-btn-sm");
    // Inside the card: the footer closes before the section does.
    expect(html).toMatch(/remix-draft-actions[\s\S]*<\/div><\/div><\/div><\/section>$/);
  });

  it("hides publish and export once published", () => {
    const html = render({ published: true });
    expect(html).not.toContain("Publish on Resonate");
    expect(html).not.toContain("Export audio");
    expect(html).toContain("remix-draft-playback-btn");
  });
});

describe("RemixDraftsPanel — previous versions", () => {
  it("lists compact version cards with chip, cost, time and playback", () => {
    const html = render({
      versions: [
        version(),
        version({
          jobId: JOB_V2,
          label: "Stem mix render",
          provenance: "stem_audio",
          costUsd: 0,
          peaks: null,
          playing: true,
          completedAt: "2026-09-20T09:30:00Z",
        }),
      ],
    });
    expect(html).toContain("Previous versions");
    expect((html.match(/remix-draft-version-btn/g) ?? []).length).toBe(2);
    expect(html).toContain("AI layer added");
    expect(html).toContain("Your stems + AI layer");
    expect(html).toContain("~$0.20");
    expect(html).toContain("2 h ago");
    expect(html).toMatch(/aria-label="Stop Stem mix render"[^>]*>Stop<\/button>/);
    expect((html.match(/remix-draft-version-waveform/g) ?? []).length).toBe(1);
  });

  it("omits the list when there are no versions", () => {
    expect(render()).not.toContain("Previous versions");
  });
});

describe("RemixDraftsPanel — no internal identifiers", () => {
  it("never renders job ids or the policy version", () => {
    const html = render({
      current: draft({ kindLabel: "AI draft" }),
      versions: [version(), version({ jobId: JOB_V2, playing: true })],
    });
    for (const id of [JOB_CURRENT, JOB_V1, JOB_V2]) {
      expect(html).not.toContain(id);
    }
    expect(html).not.toMatch(/job/i);
    expect(html).not.toMatch(/policy/i);
  });
});

describe("formatters", () => {
  it("formats completion times relative within a day, absolute beyond", () => {
    expect(formatCompletedAt(null, NOW)).toBeNull();
    expect(formatCompletedAt("not a date", NOW)).toBeNull();
    expect(formatCompletedAt(new Date(NOW - 10_000).toISOString(), NOW)).toBe("just now");
    expect(formatCompletedAt(new Date(NOW + 10_000).toISOString(), NOW)).toBe("just now");
    expect(formatCompletedAt(new Date(NOW - 45 * 60_000).toISOString(), NOW)).toBe(
      "45 min ago",
    );
    expect(formatCompletedAt(new Date(NOW - 5 * 3600_000).toISOString(), NOW)).toBe("5 h ago");
    const absolute = formatCompletedAt("2026-09-20T09:30:00Z", NOW);
    expect(absolute).not.toBeNull();
    expect(absolute).not.toMatch(/ago/);
  });
});

describe("provenance with an added beat (#1902)", () => {
  it("reads \"Your stems + your beat\" for a stem render with a beat", () => {
    expect(draftProvenanceChip("stem_audio", ["beat"])?.label).toBe(
      "Your stems + your beat",
    );
    expect(draftProvenanceChip("stem_audio", [])?.label).toBe("Your stems only");
    expect(draftProvenanceChip("stem_audio", null)?.label).toBe("Your stems only");
    // AI groundings keep their own honest label.
    expect(draftProvenanceChip("stem_plus_ai", ["beat"])?.label).toBe(
      "Your stems + AI layer",
    );
  });

  it("renders the beat chip on the current draft", () => {
    const html = renderToStaticMarkup(
      <RemixDraftsPanel
        current={draft({ addedParts: ["beat"] })}
        versions={[]}
        onPlayCurrent={noop}
        onPlayVersion={noop}
        publish={{
          enabled: true,
          reason: null,
          busy: false,
          reasonCode: "ok",
          onClick: noop,
          onLockedClick: noop,
        }}
        exportAction={{
          enabled: true,
          reason: null,
          busy: false,
          onClick: noop,
          onLockedClick: noop,
        }}
        published={false}
        emptyHint=""
        now={NOW}
      />,
    );
    expect(html).toContain("Your stems + your beat");
  });
});
