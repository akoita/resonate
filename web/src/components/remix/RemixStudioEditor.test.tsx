import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { RemixProject } from "../../lib/api";
import {
  describeGenerateAvailability,
  generationErrorMessage,
  buildProjectPatch,
  clampGainDb,
  classifyProjectLoadError,
  describeSourceRights,
  initialEdits,
  RemixStudioEditor,
  saveStatusLabel,
  stemPreviewStates,
  stemDisplayName,
} from "./RemixStudioEditor";
import {
  dbToLinearGain,
  remixDraftOutputUri,
  stemPreviewGain,
} from "../../lib/remixAudioPreview";
import RemixStudioPage from "../../app/remix/studio/[projectId]/page";

const mockUseAuth = vi.fn(() => ({ token: "jwt-token", login: vi.fn() }));

vi.mock("../auth/AuthProvider", () => ({
  useAuth: () => mockUseAuth(),
}));
vi.mock("../ui/Toast", () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));
vi.mock("next/navigation", () => ({
  useParams: () => ({ projectId: "proj-1" }),
}));

function project(overrides: Partial<RemixProject> = {}): RemixProject {
  return {
    id: "proj-1",
    creatorUserId: "user-1",
    sourceTrackId: "track-1",
    title: "Neon Drift (Remix)",
    status: "draft",
    mode: "stem_mix",
    licenseType: "remix",
    licenseId: null,
    prompt: null,
    generationProvider: null,
    generationJobId: null,
    generationMetadata: null,
    attribution: null,
    exportPolicy: null,
    policyVersion: "2026-06-09.v1",
    createdAt: "2026-06-10T00:00:00.000Z",
    updatedAt: "2026-06-10T00:00:00.000Z",
    source: {
      trackId: "track-1",
      trackTitle: "Neon Drift",
      releaseId: "rel-1",
      releaseTitle: "Night Signals",
      artistName: "Aya Volt",
      rightsRoute: "STANDARD_ESCROW",
      contentStatus: "clean",
    },
    stems: [
      {
        stemId: "stem-1",
        type: "vocals",
        title: "Lead Vocal",
        role: "lead",
        gainDb: -3,
        muted: false,
        arrangement: null,
      },
      {
        stemId: "stem-2",
        type: "drums",
        title: null,
        role: null,
        gainDb: null,
        muted: true,
        arrangement: null,
      },
    ],
    ...overrides,
  };
}

describe("classifyProjectLoadError", () => {
  it("maps 403/404/other to forbidden/missing/error", () => {
    expect(classifyProjectLoadError("API 403: Forbidden")).toBe("forbidden");
    expect(classifyProjectLoadError("API 404: Not Found")).toBe("missing");
    expect(classifyProjectLoadError("API 500: boom")).toBe("error");
    expect(classifyProjectLoadError("")).toBe("error");
  });
});

describe("clampGainDb", () => {
  it("clamps to the -24..+6 dB range and handles NaN", () => {
    expect(clampGainDb(-100)).toBe(-24);
    expect(clampGainDb(40)).toBe(6);
    expect(clampGainDb(-3.5)).toBe(-3.5);
    expect(clampGainDb(NaN)).toBe(0);
  });
});

describe("describeSourceRights", () => {
  it("labels verified routes and flags non-clean content", () => {
    expect(describeSourceRights(project().source)).toEqual({
      label: "Rights verified · standard",
      tone: "ok",
    });
    expect(
      describeSourceRights({
        ...project().source,
        rightsRoute: "TRUSTED_FAST_PATH",
      }).tone,
    ).toBe("ok");
    expect(
      describeSourceRights({ ...project().source, contentStatus: "quarantined" }),
    ).toEqual({ label: "Source under review", tone: "warning" });
    expect(
      describeSourceRights({ ...project().source, rightsRoute: null }).tone,
    ).toBe("warning");
  });
});

describe("stemDisplayName", () => {
  it("prefers the stem title and falls back to capitalized type", () => {
    expect(stemDisplayName({ type: "vocals", title: "Lead Vocal" })).toBe(
      "Lead Vocal",
    );
    expect(stemDisplayName({ type: "drums", title: null })).toBe("Drums");
  });
});

describe("audio preview helpers (#1165)", () => {
  it("converts dB gain and applies mute/solo state", () => {
    expect(dbToLinearGain(0)).toBeCloseTo(1);
    expect(dbToLinearGain(-6)).toBeCloseTo(0.501, 3);
    expect(stemPreviewGain({ stemId: "a", gainDb: -3, muted: true }, null)).toBe(0);
    expect(stemPreviewGain({ stemId: "a", gainDb: -3, muted: false }, "b")).toBe(0);
    expect(
      stemPreviewGain({ stemId: "a", gainDb: -3, muted: false }, "a"),
    ).toBeCloseTo(0.708, 3);
  });

  it("extracts playable output metadata defensively", () => {
    expect(remixDraftOutputUri(null)).toBeNull();
    expect(remixDraftOutputUri({ output: { outputUri: "" } })).toBeNull();
    expect(
      remixDraftOutputUri({ output: { outputUri: "/storage/draft.mp3" } }),
    ).toBe("/storage/draft.mp3");
  });

  it("builds preview stem state from local edits", () => {
    const p = project();
    const edits = initialEdits(p);
    edits.stems["stem-1"] = { gainDb: -12, muted: true };
    expect(stemPreviewStates(p, edits)).toEqual([
      { stemId: "stem-1", gainDb: -12, muted: true },
      { stemId: "stem-2", gainDb: null, muted: true },
    ]);
  });
});

describe("buildProjectPatch", () => {
  it("returns an empty patch when nothing changed", () => {
    const p = project();
    expect(buildProjectPatch(p, initialEdits(p))).toEqual({});
  });

  it("includes only changed top-level fields", () => {
    const p = project();
    const edits = { ...initialEdits(p), title: "Renamed", mode: "variation" };
    expect(buildProjectPatch(p, edits)).toEqual({
      title: "Renamed",
      mode: "variation",
    });
  });

  it("normalizes empty prompts to null and skips unchanged prompts", () => {
    const p = project({ prompt: "darker" });
    const cleared = { ...initialEdits(p), prompt: "   " };
    expect(buildProjectPatch(p, cleared)).toEqual({ prompt: null });
    const unchanged = initialEdits(p);
    expect(buildProjectPatch(p, unchanged)).toEqual({});
  });

  it("emits minimal per-stem patches for changed mute/gain only", () => {
    const p = project();
    const edits = initialEdits(p);
    edits.stems["stem-1"] = { gainDb: -6, muted: false };
    edits.stems["stem-2"] = { gainDb: null, muted: false };
    expect(buildProjectPatch(p, edits)).toEqual({
      stems: [
        { stemId: "stem-1", gainDb: -6 },
        { stemId: "stem-2", muted: false },
      ],
    });
  });

  it("does not emit a title patch for blank titles", () => {
    const p = project();
    const edits = { ...initialEdits(p), title: "   " };
    expect(buildProjectPatch(p, edits)).toEqual({});
  });
});

describe("saveStatusLabel", () => {
  it("prioritizes saving, then blank title, then dirty state", () => {
    expect(
      saveStatusLabel({ saving: true, dirty: true, titleBlank: true }),
    ).toBe("Saving...");
    expect(
      saveStatusLabel({ saving: false, dirty: true, titleBlank: true }),
    ).toBe("Title is required");
    expect(
      saveStatusLabel({ saving: false, dirty: true, titleBlank: false }),
    ).toBe("Unsaved changes");
    expect(
      saveStatusLabel({ saving: false, dirty: false, titleBlank: false }),
    ).toBe("All changes saved");
  });
});

describe("RemixStudioEditor rendering", () => {
  it("renders attribution, rights badge, stems, and honest unavailable actions", () => {
    const html = renderToStaticMarkup(<RemixStudioEditor project={project()} />);
    expect(html).toContain("Neon Drift");
    expect(html).toContain("Aya Volt");
    expect(html).toContain("Night Signals");
    expect(html).toContain("/release/rel-1");
    expect(html).toContain("Rights verified · standard");
    expect(html).toContain("remix license · private drafts");
    expect(html).toContain("Lead Vocal");
    expect(html).toContain("Drums");
    expect(html).toContain("Play preview");
    expect(html).toContain("solo changes playback only and is not saved");
    // Publish/export are aria-disabled with honest reasons, not hidden.
    expect(html).toContain("remix-action-unavailable--publish");
    expect(html).toContain("remix-action-unavailable--export");
    expect(html).toContain("Publishing remixes inside Resonate is not available yet");
    expect(html).toContain("Export requires a license that explicitly grants export rights");
    expect(html).toMatch(/remix-action-unavailable--publish[^>]*aria-disabled="true"|aria-disabled="true"[^>]*remix-action-unavailable--publish/);
    expect(html).toContain("No AI draft yet");
    expect(html).toContain("All changes saved");
  });

  it("shows AI draft playback when generation output exists", () => {
    const html = renderToStaticMarkup(
      <RemixStudioEditor
        project={project({
          generationJobId: "job-1",
          generationProvider: "lyria-3-pro-preview",
          generationMetadata: {
            output: {
              outputUri: "/storage/remix-drafts/job-1.mp3",
              synthIdPresent: true,
              seed: 99,
              sampleRate: 48000,
            },
          },
        })}
      />,
    );

    expect(html).toContain("AI draft recorded");
    expect(html).toContain("Play AI draft");
    expect(html).not.toContain("Playback arrives with audio preview");
  });

  it("shows no-output copy when a generation job has no playable draft", () => {
    const html = renderToStaticMarkup(
      <RemixStudioEditor
        project={project({
          generationJobId: "job-1",
          generationProvider: "remix-stub",
          generationMetadata: { output: { outputUri: null } },
        })}
      />,
    );

    expect(html).toContain("This generation has no playable draft output yet");
    expect(html).not.toContain("Play AI draft");
  });

  it("disables the prompt box with an explanation in stem mix mode", () => {
    const html = renderToStaticMarkup(<RemixStudioEditor project={project()} />);
    expect(html).toContain("Prompts apply to variation and extension modes");
    expect(html).toMatch(/<textarea[^>]*\sdisabled=""/);
  });

  it("enables the prompt box for variation mode", () => {
    const html = renderToStaticMarkup(
      <RemixStudioEditor project={project({ mode: "variation" })} />,
    );
    expect(html).not.toMatch(/<textarea[^>]*\sdisabled=""/);
  });

  it("shows a warning rights badge for monitored sources", () => {
    const html = renderToStaticMarkup(
      <RemixStudioEditor
        project={project({
          source: { ...project().source, rightsRoute: "LIMITED_MONITORING" },
        })}
      />,
    );
    expect(html).toContain("Rights state restricted");
    expect(html).toContain("remix-rights-badge--warning");
  });
});

describe("RemixStudioPage shell", () => {
  it("prompts signed-out users to sign in without fetching", () => {
    mockUseAuth.mockReturnValueOnce({ token: null as unknown as string, login: vi.fn() });
    const html = renderToStaticMarkup(<RemixStudioPage />);
    expect(html).toContain("Sign in to open this remix project");
  });

  it("shows the loading skeleton for signed-in users before the project resolves", () => {
    const html = renderToStaticMarkup(<RemixStudioPage />);
    expect(html).toContain("aria-busy");
    expect(html).toContain("animate-pulse");
  });
});


describe("describeGenerateAvailability (#1162)", () => {
  const base = { mode: "variation", prompt: "darker", saving: false, dirty: false, generating: false };

  it("is enabled for a saved, prompted project", () => {
    expect(describeGenerateAvailability(base)).toEqual({ enabled: true, reason: null });
  });

  it("explains stem_mix, blank prompt, and unsaved edits", () => {
    expect(describeGenerateAvailability({ ...base, mode: "stem_mix" }).reason).toContain(
      "variation and extension",
    );
    expect(describeGenerateAvailability({ ...base, prompt: "  " }).reason).toContain(
      "Write a prompt",
    );
    expect(describeGenerateAvailability({ ...base, dirty: true }).reason).toContain(
      "Save your changes",
    );
  });

  it("is inert without a reason while saving or generating", () => {
    expect(describeGenerateAvailability({ ...base, generating: true })).toEqual({
      enabled: false,
      reason: null,
    });
    expect(describeGenerateAvailability({ ...base, saving: true }).enabled).toBe(false);
  });
});

describe("generationErrorMessage (#1162)", () => {
  it("maps normalized codes to user copy and passes provider messages through", () => {
    expect(generationErrorMessage("provider_disabled", "x")).toContain("not enabled");
    expect(generationErrorMessage("provider_rejected", "x")).toContain("rejected this prompt");
    expect(generationErrorMessage("invalid_input", "A prompt is required.")).toBe(
      "A prompt is required.",
    );
    expect(generationErrorMessage("unknown", "x")).toContain("try again later");
  });
});
