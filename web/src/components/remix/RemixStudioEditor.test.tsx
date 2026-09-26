import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { RemixProject } from "../../lib/api";
import {
  describeAvailableStemAction,
  describeGenerateAvailability,
  describeStemTransform,
  formatDraftCost,
  draftKindLabel,
  stemTransformForGenerate,
  describePublishAvailability,
  describeExportAvailability,
  EXPORT_RIGHTS_REQUIRED_REASON,
  generationErrorMessage,
  groundingDescription,
  publishConfirmMessage,
  buildProjectPatch,
  clampGainDb,
  classifyProjectLoadError,
  describeSourceRights,
  doublingReferenceStemIds,
  effectsBpm,
  initialEdits,
  intentReturningFromMix,
  isFullMixStemType,
  normalizeAiTarget,
  previewMeterDb,
  projectMusicalSummary,
  referenceStemIds,
  RemixGenerationAttributionBadge,
  RemixSellCta,
  RemixStudioEditor,
  remixGenerationFailureMessage,
  remixGenerationIsActive,
  remixGenerationPlayableOutputUri,
  remixGenerationStatus,
  saveStatusLabel,
  stemPreviewStates,
  stemDisplayName,
  editsTimeline,
  editsWithStructure,
  editsAfterStructureOp,
  editsPreviewBeat,
  applyDescribedEdits,
  projectStructure,
  structureEditStateFor,
  AUTOSAVE_DELAY_MS,
  editsAfterSave,
  SAVING_LATEST_CHANGES_REASON,
  shouldAutosave,
  studioShortcutAction,
  transportLoopLabel,
  describeResetAvailability,
  editsAreOriginal,
  originalEdits,
  RESET_ORIGINAL_CONFIRM_MESSAGE,
  RESET_ORIGINAL_CONFIRM_TITLE,
} from "./RemixStudioEditor";
import type { RemixEligibilityResponse } from "../../lib/api";
import {
  applyVibe,
  REMIX_FX_SCHEMA_VERSION,
  withStemFx,
} from "../../lib/remixFx";
import {
  dbToLinearGain,
  remixDraftOutputUri,
  stemPreviewGain,
} from "../../lib/remixAudioPreview";
import RemixStudioPage from "../../app/remix/studio/[projectId]/page";
import { blockActionResult } from "./RemixSessionLanes";
import { REMIX_STRUCTURE_SCHEMA_VERSION } from "../../lib/remixStructure";
import {
  defaultBeat,
  normalizeRemixBeat,
  withBeatMuted,
} from "../../lib/remixBeat";

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
    publishedReleaseId: null,
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

  it("classifies queued generation metadata for status and playback", () => {
    expect(remixGenerationStatus({ status: "pending" })).toBe("pending");
    expect(remixGenerationIsActive({ status: "processing" })).toBe(true);
    expect(
      remixGenerationPlayableOutputUri({
        status: "pending",
        output: { outputUri: "/storage/draft.mp3" },
      }),
    ).toBeNull();
    expect(
      remixGenerationPlayableOutputUri({
        status: "completed",
        output: { outputUri: "/storage/draft.mp3" },
      }),
    ).toBe("/storage/draft.mp3");
    expect(
      remixGenerationFailureMessage({
        status: "failed",
        errorCode: "provider_rejected",
        errorMessage: "Rejected.",
      }),
    ).toContain("rejected this prompt");
  });

  it("builds preview stem state from local edits", () => {
    const p = project();
    const edits = initialEdits(p);
    edits.stems["stem-1"] = { gainDb: -12, muted: true, sections: null };
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
    edits.stems["stem-1"] = { gainDb: -6, muted: false, sections: null };
    edits.stems["stem-2"] = { gainDb: null, muted: false, sections: null };
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
  it("diffs the effects recipe (#1897)", () => {
    const p = project();
    expect(initialEdits(p).effects).toBeNull();
    const slowed = {
      ...initialEdits(p),
      effects: applyVibe("slowed_reverb", null, p.stems),
    };
    expect(buildProjectPatch(p, slowed)).toEqual({
      effects: {
        schemaVersion: REMIX_FX_SCHEMA_VERSION,
        master: { speed: 0.85, space: 0.45, tone: -0.15 },
      },
    });

    const saved = project({
      effects: {
        schemaVersion: REMIX_FX_SCHEMA_VERSION,
        master: { speed: 0.85 },
        stems: { "stem-1": { echo: 0.3 }, "stem-gone": { echo: 0.5 } },
      },
    });
    const baseline = initialEdits(saved);
    // Unknown stems are dropped on read; an unchanged recipe is clean.
    expect(baseline.effects?.stems).toEqual({ "stem-1": { echo: 0.3 } });
    expect(buildProjectPatch(saved, baseline)).toEqual({});
    // Same values in a different shape are still clean.
    expect(
      buildProjectPatch(saved, {
        ...baseline,
        effects: {
          schemaVersion: REMIX_FX_SCHEMA_VERSION,
          stems: { "stem-1": { echo: 0.3, tone: 0 } },
          master: { speed: 0.851 },
        },
      }),
    ).toEqual({});
    expect(
      buildProjectPatch(saved, {
        ...baseline,
        effects: withStemFx(baseline.effects, "stem-1", "tone", 0.5),
      }).effects?.stems,
    ).toEqual({ "stem-1": { echo: 0.3, tone: 0.5 } });
    // Clearing sends null.
    expect(buildProjectPatch(saved, { ...baseline, effects: null })).toEqual({
      effects: null,
    });
  });

  it("uses only a bars grid's bpm for echo sync (#1897)", () => {
    expect(effectsBpm(null)).toBeNull();
    expect(
      effectsBpm({
        kind: "bars",
        sections: [],
        sectionSeconds: 16,
        durationSeconds: 32,
        bpm: 118.4,
      }),
    ).toBe(118.4);
    expect(
      effectsBpm({
        kind: "time",
        sections: [],
        sectionSeconds: 16,
        durationSeconds: 32,
        bpm: 120,
      }),
    ).toBeNull();
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

  it("reports a failed autosave until the next save attempt (#1879)", () => {
    expect(
      saveStatusLabel({ saving: false, dirty: true, titleBlank: false, error: true }),
    ).toBe("Couldn't save your changes.");
    // A retry in flight reads as saving, not as the stale failure.
    expect(
      saveStatusLabel({ saving: true, dirty: true, titleBlank: false, error: true }),
    ).toBe("Saving...");
  });
});

describe("autosave (#1879)", () => {
  const ready = {
    dirty: true,
    titleBlank: false,
    saving: false,
    published: false,
    blocked: false,
  };

  it("debounces under a second", () => {
    expect(AUTOSAVE_DELAY_MS).toBe(800);
  });

  it("saves only real, valid changes on an editable project, one at a time", () => {
    expect(shouldAutosave(ready)).toBe(true);
    expect(shouldAutosave({ ...ready, dirty: false })).toBe(false);
    expect(shouldAutosave({ ...ready, titleBlank: true })).toBe(false);
    expect(shouldAutosave({ ...ready, saving: true })).toBe(false);
    expect(shouldAutosave({ ...ready, published: true })).toBe(false);
    // A failed save waits for the next edit or Retry.
    expect(shouldAutosave({ ...ready, blocked: true })).toBe(false);
  });

  it("re-baselines untouched edits and keeps edits typed during the save", () => {
    const saved = project({ title: "Saved title" });
    const snapshot = initialEdits(project());
    // Untouched since the request started → the saved project's edits.
    const rebased = editsAfterSave(snapshot, snapshot, saved);
    expect(rebased).not.toBe(snapshot);
    expect(rebased.title).toBe("Saved title");
    // Edited meanwhile → kept as-is (still dirty, autosaves next).
    const typed = { ...snapshot, title: "Typed while saving" };
    expect(editsAfterSave(typed, snapshot, saved)).toBe(typed);
  });
});

describe("studioShortcutAction (#1879)", () => {
  const key = (overrides: Partial<Parameters<typeof studioShortcutAction>[0]>) =>
    studioShortcutAction({
      key: " ",
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      repeat: false,
      targetTag: "BODY",
      targetEditable: false,
      focusedStemId: null,
      published: false,
      ...overrides,
    });

  it("toggles playback on Space, except where Space has a native meaning", () => {
    expect(key({})).toEqual({ kind: "toggle_playback" });
    expect(key({ key: "Spacebar" })).toEqual({ kind: "toggle_playback" });
    expect(key({ targetTag: "BUTTON" })).toBeNull();
    expect(key({ targetTag: "A" })).toBeNull();
    expect(key({ repeat: true })).toBeNull();
  });

  it("ignores modifiers and text entry", () => {
    expect(key({ ctrlKey: true })).toBeNull();
    expect(key({ metaKey: true })).toBeNull();
    expect(key({ altKey: true })).toBeNull();
    for (const tag of ["INPUT", "TEXTAREA", "SELECT", "input"]) {
      expect(key({ targetTag: tag })).toBeNull();
      expect(key({ key: "m", targetTag: tag, focusedStemId: "stem-1" })).toBeNull();
    }
    expect(key({ targetTag: "DIV", targetEditable: true })).toBeNull();
  });

  it("mutes and solos the focused lane row", () => {
    const onRow = { focusedStemId: "stem-1", targetTag: "BUTTON" };
    expect(key({ ...onRow, key: "m" })).toEqual({
      kind: "toggle_mute",
      stemId: "stem-1",
    });
    expect(key({ ...onRow, key: "M" })).toEqual({
      kind: "toggle_mute",
      stemId: "stem-1",
    });
    expect(key({ ...onRow, key: "s" })).toEqual({
      kind: "toggle_solo",
      stemId: "stem-1",
    });
    // No focused row → nothing to act on.
    expect(key({ key: "m" })).toBeNull();
    expect(key({ key: "s" })).toBeNull();
    // Published: mute is locked, solo (preview-only) still works.
    expect(key({ ...onRow, key: "m", published: true })).toBeNull();
    expect(key({ ...onRow, key: "s", published: true })).toEqual({
      kind: "toggle_solo",
      stemId: "stem-1",
    });
  });

  it("clears the loop on Escape and ignores other keys", () => {
    expect(key({ key: "Escape" })).toEqual({ kind: "clear_loop" });
    expect(key({ key: "Escape", targetTag: "BUTTON" })).toEqual({
      kind: "clear_loop",
    });
    expect(key({ key: "x" })).toBeNull();
  });
});

describe("transportLoopLabel (#1879)", () => {
  it("names bar loops like the ruler, including a pickup", () => {
    const bars = {
      kind: "bars" as const,
      sections: [
        { startSec: 0, endSec: 4 },
        { startSec: 4, endSec: 20 },
        { startSec: 20, endSec: 36 },
      ],
      sectionSeconds: 16,
      durationSeconds: 36,
      bpm: 120,
    };
    expect(transportLoopLabel(bars, 0)).toBe("Looping the pickup");
    expect(transportLoopLabel(bars, 2)).toBe("Looping bar 9");
    expect(transportLoopLabel(bars, 9)).toBeNull();
  });

  it("names time loops by their start", () => {
    const time = {
      kind: "time" as const,
      sections: [
        { startSec: 0, endSec: 25 },
        { startSec: 25, endSec: 50 },
      ],
      sectionSeconds: 25,
      durationSeconds: 50,
      bpm: null,
    };
    expect(transportLoopLabel(time, 1)).toBe("Looping 0:25");
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
    // One Session section with the transport (#1879); no manual save.
    expect(html).toContain(">Session</h2>");
    expect(html).toContain("remix-transport-toggle");
    expect(html).toContain('aria-label="Play"');
    expect(html).not.toContain("Play preview");
    expect(html).not.toContain("Save changes");
    expect(html).toContain("solo changes playback only and is not saved");
    expect(html).toContain("save automatically");
    expect(html).toContain("Space play/stop · M mute · S solo on the focused row");
    // No draft yet: the Drafts empty hint says what to do, and Publish /
    // Export only appear once a draft exists (#1879).
    expect(html).not.toContain("remix-action-publish");
    expect(html).not.toContain("Export audio");
    // stem_mix placeholder invites a render (#1189), not an AI prompt.
    expect(html).toContain("No draft yet. Render your arranged stems");
    expect(html).toContain("Render mix");
    expect(html).toContain("All changes saved");
  });

  it("locks the studio and links to the release once published (#1196)", () => {
    const html = renderToStaticMarkup(
      <RemixStudioEditor
        project={project({
          status: "published",
          publishedReleaseId: "rel-published-1",
        })}
      />,
    );
    expect(html).toContain("remix-published-banner");
    expect(html).toContain("Published on Resonate");
    expect(html).toContain("/release/rel-published-1");
    expect(html).toContain("remix-published-release-link");
    // Publish/export and the save status disappear; Create is locked.
    expect(html).not.toContain("remix-action-publish");
    expect(html).not.toContain("remix-save-status");
    expect(html).toContain("This remix is published — the studio is locked.");
    // Edits are locked; listening (the transport) still works.
    expect(html).not.toContain("Save changes");
    expect(html).toMatch(/aria-label="Mute Lead Vocal"[^>]*disabled=""/);
    expect(html).toMatch(/aria-label="Remix title"[^>]*disabled=""/);
    expect(html).toContain("remix-transport-toggle");
  });

  it("shows AI draft playback when generation output exists", () => {
    const html = renderToStaticMarkup(
      <RemixStudioEditor
        project={project({
          generationJobId: "job-1",
          generationProvider: "lyria-3-pro-preview",
          generationMetadata: {
            grounding: "feature_conditioned",
            sourceFeatureHints: { bpm: 93, key: "G minor" },
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

    // Drafts panel card (#1879): kind, chip, expandable honest detail (#1181).
    expect(html).toContain("remix-current-draft--completed");
    expect(html).toContain("AI · tempo/key matched");
    expect(html).toContain("matched to the stems&#x27; measured 93 BPM, G minor");
    expect(html).toContain("does not hear the source audio");
    expect(html).toContain('aria-label="Play draft"');
    // The transport offers the draft as a source too.
    expect(html).toMatch(/aria-pressed="false"[^>]*>Draft<\/button>/);
  });

  it("shows queued state without draft playback while generation is pending", () => {
    const html = renderToStaticMarkup(
      <RemixStudioEditor
        project={project({
          generationJobId: "job-1",
          generationProvider: "remix-queue",
          generationMetadata: {
            status: "pending",
            output: { outputUri: "/storage/remix-drafts/job-1.mp3" },
          },
        })}
      />,
    );

    expect(html).toContain("remix-current-draft--queued");
    expect(html).toContain("In progress");
    expect(html).toContain("Queued...");
    expect(html).toContain("Generation is already queued");
    expect(html).not.toContain('aria-label="Play draft"');
    // A draft exists but isn't finished: Publish/Export show, honestly gated.
    expect(html).toMatch(/remix-action-publish[^>]*aria-disabled="true"|aria-disabled="true"[^>]*remix-action-publish/);
    expect(html).toContain("wait for it to finish before publishing");
    expect(html).toContain("remix-action-unavailable--export");
  });

  it("shows failed state and retry copy", () => {
    const html = renderToStaticMarkup(
      <RemixStudioEditor
        project={project({
          generationJobId: "job-1",
          generationProvider: "remix-queue",
          mode: "variation",
          prompt: "darker",
          generationMetadata: {
            status: "failed",
            errorCode: "provider_unavailable",
            errorMessage: "The provider timed out.",
            retryable: true,
          },
        })}
      />,
    );

    expect(html).toContain("remix-current-draft--failed");
    expect(html).toContain("The provider timed out.");
    expect(html).toContain("Retry generation");
    expect(html).not.toContain('aria-label="Play draft"');
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

    expect(html).toContain("This draft has no playable output yet.");
    expect(html).not.toContain('aria-label="Play draft"');
  });

  it("lays out Session and Drafts on the left with Create spanning both rows", () => {
    const html = renderToStaticMarkup(<RemixStudioEditor project={project()} />);
    const tag = (className: string) =>
      html.match(new RegExp(`<div class="[^"]*${className}[^"]*"`))?.[0] ?? "";
    const layout = tag("remix-studio-layout");
    expect(layout).toContain("lg:grid-cols-[minmax(0,1fr)_22rem]");
    expect(layout).toContain("lg:grid-rows-[auto_1fr]");
    const session = tag("remix-studio-session-column");
    expect(session).toContain("lg:col-start-1");
    expect(session).toContain("lg:row-start-1");
    const create = tag("remix-studio-create-column");
    expect(create).toContain("lg:col-start-2");
    expect(create).toContain("lg:row-span-2");
    expect(create).toContain("lg:sticky");
    expect(create).toContain("lg:max-h-[calc(100vh-2rem)]");
    expect(create).toContain("lg:overflow-y-auto");
    const drafts = tag("remix-studio-drafts-column");
    expect(drafts).toContain("lg:col-start-1");
    expect(drafts).toContain("lg:row-start-2");
    // Stacked (mobile) order: Session → Create → Drafts.
    const sessionAt = html.indexOf("remix-studio-session-column");
    const createAt = html.indexOf("remix-studio-create-column");
    const draftsAt = html.indexOf("remix-studio-drafts-column");
    expect(sessionAt).toBeLessThan(createAt);
    expect(createAt).toBeLessThan(draftsAt);
    expect(html.indexOf("remix-create-panel")).toBeGreaterThan(createAt);
    expect(html.indexOf("remix-create-panel")).toBeLessThan(draftsAt);
    expect(html.indexOf("remix-drafts-panel")).toBeGreaterThan(draftsAt);
  });

  it("shows the free mix, not a prompt, in stem mix mode (#1879)", () => {
    const html = renderToStaticMarkup(<RemixStudioEditor project={project()} />);
    expect(html).toContain("Free — renders your arrangement exactly as you hear it.");
    expect(html).not.toContain("<textarea");
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

  it("enables stem_mix without a prompt — render needs no direction (#1189)", () => {
    expect(
      describeGenerateAvailability({ ...base, mode: "stem_mix", prompt: "" }),
    ).toEqual({ enabled: true, reason: null });
  });

  it("explains blank prompt and unsaved edits", () => {
    expect(describeGenerateAvailability({ ...base, prompt: "  " }).reason).toContain(
      "Write a prompt",
    );
    // Autosave settles dirty edits: the gate is transient copy (#1879).
    expect(describeGenerateAvailability({ ...base, dirty: true }).reason).toBe(
      SAVING_LATEST_CHANGES_REASON,
    );
    // Unsaved edits still block stem_mix renders: the render uses the
    // saved arrangement.
    expect(
      describeGenerateAvailability({ ...base, mode: "stem_mix", dirty: true })
        .enabled,
    ).toBe(false);
  });

  it("is inert without a reason while saving or generating", () => {
    expect(describeGenerateAvailability({ ...base, generating: true })).toEqual({
      enabled: false,
      reason: null,
    });
    expect(
      describeGenerateAvailability({ ...base, generationActive: true }).reason,
    ).toContain("already queued");
    expect(describeGenerateAvailability({ ...base, saving: true }).enabled).toBe(false);
  });
});

describe("RemixGenerationAttributionBadge (#1342)", () => {
  const stability = {
    poweredBy: "Powered by Stability AI",
    model: "Stable Audio 3",
    licenseName: "Stability AI Community License",
    licenseUrl: "https://stability.ai/license",
  };

  it("renders the 'Powered by Stability AI' notice and license link when attribution is present", () => {
    const html = renderToStaticMarkup(
      <RemixGenerationAttributionBadge attribution={stability} />,
    );
    expect(html).toContain("Powered by Stability AI");
    expect(html).toContain("Stable Audio 3");
    expect(html).toContain("https://stability.ai/license");
    expect(html).toContain("Stability AI Community License");
  });

  it("renders nothing when no attribution is required (Lyria / stem-plus-AI)", () => {
    expect(
      renderToStaticMarkup(
        <RemixGenerationAttributionBadge attribution={null} />,
      ),
    ).toBe("");
    expect(
      renderToStaticMarkup(
        <RemixGenerationAttributionBadge attribution={undefined} />,
      ),
    ).toBe("");
  });
});

describe("groundingDescription (#1181)", () => {
  it("states that rendered drafts contain the source audio", () => {
    expect(groundingDescription({ grounding: "stem_audio" })).toContain(
      "contains the licensed source audio",
    );
    expect(groundingDescription({ grounding: "stem_audio" })).toContain(
      "normalized headroom",
    );
  });

  it("names the measured hints for feature-conditioned drafts", () => {
    expect(
      groundingDescription({
        grounding: "feature_conditioned",
        sourceFeatureHints: { bpm: 93, key: "G minor" },
      }),
    ).toContain("measured 93 BPM, G minor");
    expect(
      groundingDescription({ grounding: "feature_conditioned" }),
    ).toContain("measured tempo and key");
  });

  it("labels audio-conditioned drafts as stem-audio conditioned AI drafts", () => {
    expect(groundingDescription({ grounding: "audio_conditioned" })).toContain(
      "conditioned on your stem audio",
    );
    expect(groundingDescription({ grounding: "audio_conditioned" })).toContain(
      "draft quality",
    );
  });

  it("labels stem-plus-AI drafts as source stems with generated layers", () => {
    expect(groundingDescription({ grounding: "stem_plus_ai" })).toContain(
      "licensed stems plus AI-generated layers",
    );
    expect(groundingDescription({ grounding: "stem_plus_ai" })).toContain(
      "source audio stays",
    );
    expect(groundingDescription({ grounding: "stem_plus_ai" })).toContain(
      "one normalized final mix",
    );
  });

  it("is explicit that prompt-only drafts are not derived from the source", () => {
    expect(groundingDescription({ grounding: "prompt_only" })).toContain(
      "not derived from the source audio",
    );
  });

  it("returns null for legacy metadata without grounding", () => {
    expect(groundingDescription(null)).toBeNull();
    expect(groundingDescription({})).toBeNull();
    expect(groundingDescription({ grounding: "future_mode" })).toBeNull();
  });
});

describe("describePublishAvailability (#1196)", () => {
  const eligible: RemixEligibilityResponse = {
    allowed: true,
    requiredLicense: null,
    allowedActions: ["private_draft", "publish_resonate"],
    reasons: [],
    policyVersion: "2026-06-13.v5",
    source: { trackId: "t1", rightsRoute: "STANDARD_ESCROW", contentStatus: "clean" },
    stems: [],
  };
  const base = {
    status: "draft",
    generationStatus: "completed" as const,
    hasDraftOutput: true,
    dirty: false,
    publishing: false,
    eligibility: eligible,
  };

  it("enables publish for a completed, saved draft on an allowed source", () => {
    expect(describePublishAvailability(base)).toEqual({
      enabled: true,
      reason: null,
      reasonCode: "publish_available",
    });
  });

  it("blocks until a completed draft exists", () => {
    expect(
      describePublishAvailability({ ...base, generationStatus: "processing" })
        .reasonCode,
    ).toBe("publish_needs_completed_draft");
    expect(
      describePublishAvailability({ ...base, hasDraftOutput: false }).reasonCode,
    ).toBe("publish_needs_completed_draft");
  });

  it("asks to save unsaved changes first", () => {
    const result = describePublishAvailability({ ...base, dirty: true });
    expect(result.enabled).toBe(false);
    expect(result.reasonCode).toBe("publish_dirty");
    expect(result.reason).toBe("Saving your latest changes…");
  });

  it("stays disabled while eligibility is still loading", () => {
    expect(
      describePublishAvailability({ ...base, eligibility: null }).reasonCode,
    ).toBe("publish_eligibility_loading");
  });

  it("blocks when eligibility no longer grants publish_resonate", () => {
    expect(
      describePublishAvailability({
        ...base,
        eligibility: { ...eligible, allowedActions: ["private_draft"] },
      }).reasonCode,
    ).toBe("publish_not_allowed");
    expect(
      describePublishAvailability({
        ...base,
        eligibility: { ...eligible, allowed: false },
      }).reasonCode,
    ).toBe("publish_not_allowed");
  });

  it("treats already-published projects as not publishable", () => {
    expect(
      describePublishAvailability({ ...base, status: "published" }).reasonCode,
    ).toBe("publish_already_published");
  });
});

describe("describeExportAvailability (#1323)", () => {
  const commercial: RemixEligibilityResponse = {
    allowed: true,
    requiredLicense: null,
    allowedActions: ["private_draft", "publish_resonate", "export"],
    reasons: [],
    policyVersion: "2026-07-03.v6",
    source: { trackId: "t1", rightsRoute: "STANDARD_ESCROW", contentStatus: "clean" },
    stems: [],
  };
  const remixOnly: RemixEligibilityResponse = {
    ...commercial,
    allowedActions: ["private_draft", "publish_resonate"],
  };
  const base = {
    status: "draft",
    generationStatus: "completed" as const,
    hasDraftOutput: true,
    dirty: false,
    exporting: false,
    eligibility: commercial,
  };

  it("enables export for a completed, saved draft on a commercial-licensed source", () => {
    expect(describeExportAvailability(base)).toEqual({
      enabled: true,
      reason: null,
      reasonCode: "export_available",
    });
  });

  it("keeps the honest export_rights_required state for a remix-only license", () => {
    const result = describeExportAvailability({
      ...base,
      eligibility: remixOnly,
    });
    expect(result.enabled).toBe(false);
    expect(result.reasonCode).toBe("export_rights_required");
    expect(result.reason).toBe(EXPORT_RIGHTS_REQUIRED_REASON);
  });

  it("blocks until a completed draft exists", () => {
    expect(
      describeExportAvailability({ ...base, generationStatus: "processing" })
        .reasonCode,
    ).toBe("export_needs_completed_draft");
    expect(
      describeExportAvailability({ ...base, hasDraftOutput: false }).reasonCode,
    ).toBe("export_needs_completed_draft");
  });

  it("asks to save unsaved changes first", () => {
    const result = describeExportAvailability({ ...base, dirty: true });
    expect(result.reasonCode).toBe("export_dirty");
    expect(result.reason).toBe(SAVING_LATEST_CHANGES_REASON);
  });

  it("stays disabled while eligibility is still loading", () => {
    expect(
      describeExportAvailability({ ...base, eligibility: null }).reasonCode,
    ).toBe("export_eligibility_loading");
  });

  it("treats non-draft projects as not exportable", () => {
    expect(
      describeExportAvailability({ ...base, status: "published" }).reasonCode,
    ).toBe("export_not_draft");
  });
});

describe("RemixSellCta (#1413)", () => {
  it("renders an enabled link into the release page's NFT Marketplace section when sellable", () => {
    const html = renderToStaticMarkup(
      <RemixSellCta
        commerce={{
          sellable: true,
          reasonCode: null,
          reason: null,
          publishedReleaseId: "rel-x",
          masterStemId: "stem-master-1",
        }}
      />,
    );
    expect(html).toContain("List this remix for sale");
    expect(html).toContain('href="/release/rel-x#nft-marketplace"');
    expect(html).not.toContain("aria-disabled");
  });

  it("renders a non-navigating, aria-disabled control with the honest reason when published but not sellable", () => {
    const html = renderToStaticMarkup(
      <RemixSellCta
        commerce={{
          sellable: false,
          reasonCode: "commercial_license_required",
          reason:
            "Listing a remix for sale needs a commercial license on the source stems.",
          publishedReleaseId: "rel-x",
          masterStemId: "stem-master-1",
        }}
      />,
    );
    expect(html).toContain("List this remix for sale");
    expect(html).toContain("aria-disabled=\"true\"");
    expect(html).toContain(
      "Listing a remix for sale needs a commercial license on the source stems.",
    );
    expect(html).not.toContain("<a ");
  });

  it("renders nothing when there is no commerce data (unpublished, or not yet loaded)", () => {
    expect(renderToStaticMarkup(<RemixSellCta commerce={null} />)).toBe("");
    expect(renderToStaticMarkup(<RemixSellCta commerce={undefined} />)).toBe(
      "",
    );
  });
});

describe("Export audio button (#1323)", () => {
  const completedDraft = {
    status: "completed" as const,
    grounding: "stem_audio",
    output: { outputUri: "local://draft.mp3" },
  };

  it("renders the locked unavailable state for a remix-only license", () => {
    const html = renderToStaticMarkup(
      <RemixStudioEditor
        project={project({
          generationJobId: "job-1",
          generationProvider: "stem-mix-render",
          generationMetadata: completedDraft,
          eligibility: {
            allowed: true,
            requiredLicense: null,
            allowedActions: ["private_draft", "publish_resonate"],
            reasons: [],
            policyVersion: "2026-07-03.v6",
            source: {
              trackId: "track-1",
              rightsRoute: "STANDARD_ESCROW",
              contentStatus: "clean",
            },
            stems: [],
          },
        })}
      />,
    );
    // Server-side render has no useEffect eligibility fetch, so the button
    // stays in its honest disabled state regardless of the passed eligibility.
    expect(html).toContain("remix-action-unavailable--export");
    expect(html).toContain("Export audio");
    expect(html).not.toContain("remix-action-export\"");
  });

  it("renders the enabled download button when eligibility grants export", () => {
    // describeExportAvailability drives the button; assert the enabled branch
    // directly since SSR does not run the eligibility-fetch effect.
    const result = describeExportAvailability({
      status: "draft",
      generationStatus: "completed",
      hasDraftOutput: true,
      dirty: false,
      exporting: false,
      eligibility: {
        allowed: true,
        requiredLicense: null,
        allowedActions: ["private_draft", "publish_resonate", "export"],
        reasons: [],
        policyVersion: "2026-07-03.v6",
        source: {
          trackId: "track-1",
          rightsRoute: "STANDARD_ESCROW",
          contentStatus: "clean",
        },
        stems: [],
      },
    });
    expect(result.enabled).toBe(true);
    expect(result.reasonCode).toBe("export_available");
  });
});

describe("publishConfirmMessage (#1196)", () => {
  const source = {
    trackId: "t1",
    trackTitle: "Neon Drift",
    releaseId: "rel-1",
    releaseTitle: "Night Signals",
    artistName: "Aya Volt",
    rightsRoute: "STANDARD_ESCROW",
    contentStatus: "clean",
  };

  it("states the title, source attribution, and AI-provenance label", () => {
    const message = publishConfirmMessage({
      title: "Neon Drift (Remix)",
      source,
      grounding: groundingDescription({ grounding: "feature_conditioned" }),
    });
    expect(message).toContain("Neon Drift (Remix)");
    expect(message).toContain('Remix of "Neon Drift" by Aya Volt');
    expect(message).toContain("AI-generated");
    expect(message).toContain("public remix release");
  });

  it("omits the provenance line when grounding is unknown", () => {
    const message = publishConfirmMessage({ title: "X", source, grounding: null });
    expect(message).toContain('Remix of "Neon Drift" by Aya Volt');
    expect(message).not.toContain("AI-generated");
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

  it("shows the server's extracted message when the transport strips the code", () => {
    // apiRequest throws "API 503: <server message>" — observed live on
    // staging: the toast showed a generic fallback instead of the server's
    // clear "not enabled on this environment yet" reason.
    expect(
      generationErrorMessage(
        "server_message",
        "AI remix generation is not enabled on this environment yet.",
      ),
    ).toBe("AI remix generation is not enabled on this environment yet.");
  });
});


describe("prompt preset chips (#1177)", () => {
  it("renders no chips in stem_mix mode", () => {
    const html = renderToStaticMarkup(<RemixStudioEditor project={project()} />);
    expect(html).not.toContain("Prompt presets");
  });

  it("renders mode-specific chips in prompted modes", () => {
    const html = renderToStaticMarkup(
      <RemixStudioEditor project={{ ...project(), mode: "variation" }} />,
    );
    expect(html).toContain("Prompt presets");
    expect(html).toContain("Lo-fi chill");
    expect(html).toContain("Club remix");
    expect(html).not.toContain("Build a drop");

    const extensionHtml = renderToStaticMarkup(
      <RemixStudioEditor project={{ ...project(), mode: "extension" }} />,
    );
    expect(extensionHtml).toContain("Build a drop");
    expect(extensionHtml).not.toContain("Lo-fi chill");
  });

  it("marks the chip active when the saved prompt matches its text", () => {
    const html = renderToStaticMarkup(
      <RemixStudioEditor
        project={{
          ...project(),
          mode: "variation",
          prompt:
            "A slowed, dusty lo-fi reinterpretation with mellow keys, soft vinyl crackle, and a relaxed head-nod groove.",
        }}
      />,
    );
    expect(html).toContain('aria-pressed="true"');
  });
});

describe("describeAvailableStemAction (#1312)", () => {
  const base = {
    stemId: "stem-9",
    type: "drums",
    title: null,
    tokenId: "9102",
    remixable: true as boolean | null,
    licensed: true,
    addable: true,
  };

  it("offers Add to session for addable stems", () => {
    expect(describeAvailableStemAction(base)).toEqual({
      kind: "add",
      label: "Add to session",
    });
  });

  it("routes unlicensed stems to the minted stem's license page", () => {
    expect(
      describeAvailableStemAction({ ...base, licensed: false, addable: false }),
    ).toEqual({
      kind: "license",
      label: "Get remix license",
      href: "/stem/9102",
    });
  });

  it("has no license link for unminted stems", () => {
    expect(
      describeAvailableStemAction({
        ...base,
        licensed: false,
        addable: false,
        tokenId: null,
        remixable: null,
      }),
    ).toMatchObject({ kind: "license", href: null });
  });

  it("blocks non-remixable mints with an honest reason", () => {
    expect(
      describeAvailableStemAction({ ...base, remixable: false, addable: false }),
    ).toEqual({ kind: "blocked", label: "Minted without remix rights" });
  });

  it("blocks licensed stems when the source itself is not remixable", () => {
    expect(
      describeAvailableStemAction({ ...base, addable: false }),
    ).toMatchObject({ kind: "blocked" });
  });
});

describe("projectMusicalSummary (Phase 0)", () => {
  const grid = {
    kind: "bars" as const,
    sections: [
      { startSec: 0, endSec: 16 },
      { startSec: 16, endSec: 32 },
    ],
    sectionSeconds: 16,
    durationSeconds: 32,
    bpm: 107.7,
  };

  it("takes tempo from the bar grid only", () => {
    expect(projectMusicalSummary(project({ sectionGrid: grid })).bpm).toBe(108);
    expect(
      projectMusicalSummary(
        project({ sectionGrid: { ...grid, kind: "time", bpm: 107.7 } }),
      ).bpm,
    ).toBeNull();
    expect(
      projectMusicalSummary(project({ sectionGrid: { ...grid, bpm: null } })).bpm,
    ).toBeNull();
    // A per-stem tempo artifact never becomes the project tempo.
    const noGrid = project();
    noGrid.stems[0].audioFeatures = { tempoBpm: 157, tempoConfidence: 0.9 };
    expect(projectMusicalSummary(noGrid).bpm).toBeNull();
  });

  it("votes the key across pitched stems, weighted by confidence", () => {
    const p = project();
    p.stems = [
      {
        ...p.stems[0],
        stemId: "v",
        type: "vocals",
        audioFeatures: { key: { tonic: "C", mode: "minor", confidence: 0.4 } },
      },
      {
        ...p.stems[0],
        stemId: "b",
        type: "bass",
        audioFeatures: { key: { tonic: "C", mode: "minor", confidence: 0.3 } },
      },
      {
        ...p.stems[0],
        stemId: "g",
        type: "guitar",
        audioFeatures: { key: { tonic: "G", mode: "major", confidence: 0.6 } },
      },
      {
        // Drums carry no reliable key and must not vote, however confident.
        ...p.stems[0],
        stemId: "d",
        type: "drums",
        audioFeatures: { key: { tonic: "A#", mode: "minor", confidence: 0.99 } },
      },
    ];
    expect(projectMusicalSummary(p).key).toBe("C minor"); // 0.7 > 0.6

    p.stems[2].audioFeatures = {
      key: { tonic: "G", mode: "major", confidence: 0.9 },
    };
    expect(projectMusicalSummary(p).key).toBe("G major"); // 0.9 > 0.7
  });

  it("defaults a missing confidence to 0.5 and breaks exact ties by first seen", () => {
    const p = project();
    p.stems = [
      {
        ...p.stems[0],
        stemId: "a",
        type: "vocals",
        audioFeatures: { key: { tonic: "E", mode: "minor", confidence: null } },
      },
      {
        ...p.stems[0],
        stemId: "b",
        type: "piano",
        audioFeatures: { key: { tonic: "G", mode: "major", confidence: 0.5 } },
      },
    ];
    expect(projectMusicalSummary(p).key).toBe("E minor");
  });

  it("makes no claim when nothing is measured", () => {
    expect(projectMusicalSummary(project())).toEqual({ bpm: null, key: null });
  });
});

describe("full-mix reference stems (Phase 0)", () => {
  function withOriginal(originalMuted: boolean, separatedMuted?: boolean) {
    const p = project();
    const stems = p.stems.map((stem) =>
      separatedMuted === undefined ? stem : { ...stem, muted: separatedMuted },
    );
    p.stems = [
      {
        stemId: "stem-original",
        type: "original",
        title: null,
        role: null,
        gainDb: null,
        muted: originalMuted,
        arrangement: null,
      },
      ...stems,
    ];
    return p;
  }

  it("recognizes full-mix stem types", () => {
    expect(isFullMixStemType("original")).toBe(true);
    expect(isFullMixStemType(" Master ")).toBe(true);
    expect(isFullMixStemType("vocals")).toBe(false);
    expect(isFullMixStemType("")).toBe(false);
  });

  it("treats a full mix as a reference only next to separated stems", () => {
    expect([...referenceStemIds(withOriginal(true).stems)]).toEqual([
      "stem-original",
    ]);
    // A lone original stays a normal mixer channel.
    expect(
      referenceStemIds([{ stemId: "o", type: "original" }]).size,
    ).toBe(0);
    expect(referenceStemIds(project().stems).size).toBe(0);
  });

  it("flags doubling only when a separated stem is audible alongside the unmuted original", () => {
    // Fixture: vocals unmuted, drums muted → doubled.
    const doubled = withOriginal(false);
    expect([
      ...doublingReferenceStemIds(doubled.stems, initialEdits(doubled)),
    ]).toEqual(["stem-original"]);
    // Stem-page entry from the original: every sibling muted → plays once.
    const single = withOriginal(false, true);
    expect(
      doublingReferenceStemIds(single.stems, initialEdits(single)).size,
    ).toBe(0);
    // Unmuting a sibling in the local edits makes it doubled.
    const edits = initialEdits(single);
    edits.stems["stem-1"] = { ...edits.stems["stem-1"], muted: false };
    expect(doublingReferenceStemIds(single.stems, edits).size).toBe(1);
    // A muted reference never doubles.
    const muted = withOriginal(true);
    expect(
      doublingReferenceStemIds(muted.stems, initialEdits(muted)).size,
    ).toBe(0);
  });

  it("section-gates a reference only while it is an unmuted channel", () => {
    const p = withOriginal(true);
    p.sectionGrid = {
      kind: "bars",
      sections: [
        { startSec: 0, endSec: 16 },
        { startSec: 16, endSec: 32 },
      ],
      sectionSeconds: 16,
      durationSeconds: 32,
      bpm: 120,
    };
    const edits = initialEdits(p);
    edits.stems["stem-original"] = {
      ...edits.stems["stem-original"],
      sections: [false, true],
    };
    const states = stemPreviewStates(p, edits);
    expect(states[0].stemId).toBe("stem-original");
    // Muted reference: out of the render, so the A/B plays it whole.
    expect(states[0].activeIntervals).toBeUndefined();
    expect(states[1].activeIntervals).toBeNull(); // separated stems still gate
    // Unmuted (legacy) reference is a real channel: gate it like the render.
    edits.stems["stem-original"] = {
      ...edits.stems["stem-original"],
      muted: false,
    };
    expect(stemPreviewStates(p, edits)[0].activeIntervals).toEqual([
      { startSec: 16, endSec: 32 },
    ]);
  });

  it("warns about a doubled mix with a one-click fix", () => {
    const html = renderToStaticMarkup(
      <RemixStudioEditor project={withOriginal(false)} />,
    );
    expect(html).toContain("is the full mix of the track");
    expect(html).toContain("your mix is doubled");
    expect(html).toContain("Use as reference only");
    // Still visible and editable while unmuted.
    expect(html).toContain('aria-label="Original gain in decibels"');
  });

  it("stays quiet while the original plays alone", () => {
    const html = renderToStaticMarkup(
      <RemixStudioEditor project={withOriginal(false, true)} />,
    );
    expect(html).not.toContain("your mix is doubled");
  });

  it("hides a muted reference from the lanes and offers it as the Original source", () => {
    const html = renderToStaticMarkup(
      <RemixStudioEditor project={withOriginal(true)} />,
    );
    expect(html).not.toContain('aria-label="Original gain in decibels"');
    expect(html).not.toContain("your mix is doubled");
    // A/B lives in the transport's source switch now (#1879).
    expect(html).not.toContain("Compare with original");
    expect(html).toContain('aria-label="Preview source"');
    expect(html).toMatch(/aria-pressed="true"[^>]*>Arrangement<\/button>/);
    expect(html).toMatch(/aria-pressed="false"[^>]*>Original<\/button>/);
    // Lanes render the channel stems only.
    expect(html).toContain('data-stem-id="stem-1"');
    expect(html).toContain('data-stem-id="stem-2"');
    expect(html).not.toContain('data-stem-id="stem-original"');
    // The muted reference does not trigger the "start muted" hint on its own.
    const allOn = withOriginal(true, false);
    expect(
      renderToStaticMarkup(<RemixStudioEditor project={allOn} />),
    ).not.toContain("start muted");
  });

  it("offers no Original source without a reference", () => {
    const html = renderToStaticMarkup(<RemixStudioEditor project={project()} />);
    // The transport's Original source (the vibe reset is "No effects").
    expect(html).not.toContain("original full mix");
    // Arrangement alone needs no switch.
    expect(html).not.toContain('aria-label="Preview source"');
  });
});

describe("preview level meter (Phase 0)", () => {
  it("maps peak to dBFS over the -48..0 meter range", () => {
    expect(previewMeterDb(1)).toBe(0);
    expect(previewMeterDb(2)).toBe(0);
    expect(previewMeterDb(0.5)).toBeCloseTo(-6.02, 2);
    expect(previewMeterDb(0)).toBe(-48);
    expect(previewMeterDb(0.0001)).toBe(-48);
    expect(previewMeterDb(Number.NaN)).toBe(-48);
  });
});

describe("Also on this track panel (#1312)", () => {
  const availableStems = [
    {
      stemId: "stem-add",
      type: "piano",
      title: "Keys",
      tokenId: "9106",
      remixable: true,
      licensed: true,
      addable: true,
    },
    {
      stemId: "stem-license",
      type: "guitar",
      title: null,
      tokenId: "9107",
      remixable: true,
      licensed: false,
      addable: false,
    },
    {
      stemId: "stem-locked",
      type: "bass",
      title: null,
      tokenId: "9108",
      remixable: false,
      licensed: false,
      addable: false,
    },
  ];

  it("renders add, license, and blocked rows for a draft project", () => {
    const html = renderToStaticMarkup(
      <RemixStudioEditor project={project({ availableStems })} />,
    );
    expect(html).toContain("Also on this track");
    expect(html).toContain("Add to session");
    expect(html).toContain('href="/stem/9107"');
    expect(html).toContain("Get remix license");
    expect(html).toContain("Minted without remix rights");
  });

  it("hides the panel when every source stem is already in the session", () => {
    const html = renderToStaticMarkup(
      <RemixStudioEditor project={project({ availableStems: [] })} />,
    );
    expect(html).not.toContain("Also on this track");
  });

  it("shows one project-level musical summary, not per-stem chips", () => {
    const withFeatures = project({
      sectionGrid: {
        kind: "bars",
        sections: [
          { startSec: 0, endSec: 16 },
          { startSec: 16, endSec: 32 },
        ],
        sectionSeconds: 16,
        durationSeconds: 32,
        bpm: 108,
      },
    });
    withFeatures.stems[0].audioFeatures = {
      tempoBpm: 157,
      tempoConfidence: 0.9,
      key: { tonic: "A", mode: "major", confidence: 0.9 },
    };
    const html = renderToStaticMarkup(
      <RemixStudioEditor project={withFeatures} />,
    );
    expect(html).toContain("108 BPM · A major");
    expect(html).toContain('title="Measured from the stem audio"');
    expect(html).not.toContain("157 BPM");
  });
});

describe("section-grid arrangement (#1314)", () => {
  const sectionGrid = {
    kind: "bars" as const,
    sections: [
      { startSec: 0, endSec: 16 },
      { startSec: 16, endSec: 32 },
      { startSec: 32, endSec: 48 },
      { startSec: 48, endSec: 64 },
    ],
    sectionSeconds: 16,
    durationSeconds: 64,
    bpm: 120,
  };
  const mask = (sections: boolean[]) => ({
    schemaVersion: "remix-stem-arrangement/v1",
    sections,
  });

  function gridProject(overrides: Partial<RemixProject> = {}): RemixProject {
    const base = project({ sectionGrid });
    base.stems[1].arrangement = mask([true, true, false, true]);
    return { ...base, ...overrides };
  }

  it("initialEdits parses persisted masks against the served grid", () => {
    const edits = initialEdits(gridProject());
    expect(edits.stems["stem-1"].sections).toBeNull(); // no mask → default
    expect(edits.stems["stem-2"].sections).toEqual([true, true, false, true]);
    // Without a grid, masks are ignored entirely.
    const noGrid = initialEdits(project());
    expect(noGrid.stems["stem-1"].sections).toBeNull();
  });

  it("buildProjectPatch diffs masks and clears back to default with null", () => {
    const proj = gridProject();
    const edits = initialEdits(proj);
    expect(buildProjectPatch(proj, edits)).toEqual({}); // round-trip clean

    edits.stems["stem-1"] = {
      ...edits.stems["stem-1"],
      sections: [false, true, true, true],
    };
    expect(buildProjectPatch(proj, edits).stems).toEqual([
      {
        stemId: "stem-1",
        arrangement: mask([false, true, true, true]),
      },
    ]);

    // Restoring all-on sends an explicit null (server clears the column).
    const clearing = initialEdits(proj);
    clearing.stems["stem-2"] = { ...clearing.stems["stem-2"], sections: null };
    expect(buildProjectPatch(proj, clearing).stems).toEqual([
      { stemId: "stem-2", arrangement: null },
    ]);
  });

  it("stemPreviewStates gates the preview at the saved/edited spans", () => {
    const proj = gridProject();
    const states = stemPreviewStates(proj, initialEdits(proj));
    const vocal = states.find((state) => state.stemId === "stem-1")!;
    const drums = states.find((state) => state.stemId === "stem-2")!;
    expect(vocal.activeIntervals).toBeNull(); // fully active
    expect(drums.activeIntervals).toEqual([
      { startSec: 0, endSec: 32 },
      { startSec: 48, endSec: 64 },
    ]);
    // No grid → no gating key at all.
    const ungated = stemPreviewStates(project(), initialEdits(project()));
    expect("activeIntervals" in ungated[0]).toBe(false);
  });

  it("renders section cells in the session lanes with honest labels (#1879)", () => {
    const html = renderToStaticMarkup(
      <RemixStudioEditor project={gridProject()} />,
    );
    expect(html).toContain(">Session</h2>");
    expect(html).not.toContain("remix-arrangement-grid");
    expect(html).toContain("8-bar sections · measured 120 BPM");
    expect(html).toContain("0:16"); // section start column label
    expect(html).toContain('aria-label="Drums: section 3 off"');
    expect(html).toContain('aria-label="Lead Vocal: section 3 on"');
  });

  it("shows waveform-only lanes when the source has no grid", () => {
    const html = renderToStaticMarkup(<RemixStudioEditor project={project()} />);
    expect(html).toContain("remix-lane-row");
    expect(html).not.toContain("remix-lane-cell");
    expect(html).not.toContain("8-bar sections");
  });
});

describe("per-stem AI transforms (#1316)", () => {
  it("stemTransformForGenerate resolves payloads and honest problems", () => {
    const stems = [{ stemId: "stem-1" }, { stemId: "stem-2" }];
    const edits = initialEdits(project());

    expect(stemTransformForGenerate("whole", null, stems, edits)).toEqual({});
    expect(
      stemTransformForGenerate("add_layer", null, stems, edits),
    ).toEqual({ transform: { kind: "add_layer" } });
    expect(
      stemTransformForGenerate("replace_stem", "stem-2", stems, edits),
    ).toEqual({ transform: { kind: "replace_stem", stemId: "stem-2" } });
    expect(
      stemTransformForGenerate("replace_stem", null, stems, edits).problem,
    ).toMatch(/Pick the stem/);
    // Replacing the only unmuted stem (stem-2 is muted in the fixture).
    expect(
      stemTransformForGenerate("replace_stem", "stem-1", stems, edits).problem,
    ).toMatch(/unmute another stem/);
  });

  it("describeStemTransform speaks the user's language", () => {
    expect(describeStemTransform(undefined)).toBeNull();
    expect(
      describeStemTransform({
        kind: "replace_stem",
        stemId: "s",
        stemLabel: "drums",
      }),
    ).toBe(
      "AI drums replacement — generated to take the drums's place over your other stems.",
    );
    expect(describeStemTransform({ kind: "add_layer" })).toBe(
      "New AI layer — generated to sit on top of your arranged stems.",
    );
  });

  it("renders the AI intents in prompted modes only (#1879)", () => {
    const variation = renderToStaticMarkup(
      <RemixStudioEditor project={project({ mode: "variation" })} />,
    );
    expect(variation).toContain('aria-label="AI intent"');
    expect(variation).toContain("Add a new part");
    expect(variation).toContain("Replace a stem");

    const stemMix = renderToStaticMarkup(
      <RemixStudioEditor project={project()} />,
    );
    expect(stemMix).not.toContain('aria-label="AI intent"');
  });

  it("shows the transform note on completed drafts", () => {
    const html = renderToStaticMarkup(
      <RemixStudioEditor
        project={project({
          mode: "variation",
          generationJobId: "job-1",
          generationProvider: "stem-plus-ai-layered-render",
          generationMetadata: {
            status: "completed",
            grounding: "stem_plus_ai",
            stemTransform: {
              kind: "replace_stem",
              stemId: "stem-2",
              stemLabel: "drums",
            },
            output: { outputUri: "local://draft.mp3" },
          },
        })}
      />,
    );
    expect(html).toContain("AI drums replacement");
  });
});

describe("muted hydrated stems hint (#1318)", () => {
  it("explains muted stems when the session has any", () => {
    // Fixture stem-2 is muted → the hint shows.
    const html = renderToStaticMarkup(<RemixStudioEditor project={project()} />);
    expect(html).toContain("start muted");
  });

  it("stays quiet when every stem is audible", () => {
    const allOn = project();
    allOn.stems = allOn.stems.map((stem) => ({ ...stem, muted: false }));
    const html = renderToStaticMarkup(<RemixStudioEditor project={allOn} />);
    expect(html).not.toContain("start muted");
  });
});

describe("draft versions + honest cost (#1320)", () => {
  const previousDrafts = [
    {
      jobId: "rmxgen_old",
      provider: "stem-plus-ai-layered-render",
      mode: "variation",
      grounding: "stem_plus_ai",
      stemTransform: {
        kind: "replace_stem" as const,
        stemId: "stem-2",
        stemLabel: "drums",
      },
      estimatedCostUsd: 0.12,
      completedAt: "2026-07-01T10:00:00.000Z",
      output: { outputUri: "local://old.mp3", mimeType: "audio/mpeg" },
    },
  ];

  it("formatDraftCost shows only positive recorded costs", () => {
    expect(formatDraftCost(0.12)).toBe("~$0.12");
    expect(formatDraftCost(0)).toBeNull(); // stem-mix renders stay unlabelled
    expect(formatDraftCost(null)).toBeNull();
    expect(formatDraftCost(undefined)).toBeNull();
    expect(formatDraftCost(Number.NaN)).toBeNull();
  });

  it("draftKindLabel says what a draft is, in a few words (#1879)", () => {
    expect(
      draftKindLabel("stem_plus_ai", { kind: "replace_stem", stemLabel: "drums" }),
    ).toBe("AI drums replacement");
    expect(draftKindLabel("stem_plus_ai", { kind: "replace_stem" })).toBe(
      "AI stem replacement",
    );
    expect(draftKindLabel("stem_plus_ai", { kind: "add_layer" })).toBe(
      "AI layer added",
    );
    expect(draftKindLabel("stem_audio", null)).toBe("Stem mix render");
    expect(draftKindLabel("feature_conditioned", undefined)).toBe("AI draft");
    expect(draftKindLabel(null, null)).toBe("AI draft");
    // A queued render has no grounding yet: its mode tells.
    expect(draftKindLabel(undefined, undefined, "stem_mix")).toBe(
      "Stem mix render",
    );
    expect(draftKindLabel(undefined, undefined, "variation")).toBe("AI draft");
  });

  it("renders the versions list and the recorded cost on completed drafts", () => {
    const html = renderToStaticMarkup(
      <RemixStudioEditor
        project={project({
          mode: "variation",
          generationJobId: "rmxgen_new",
          generationProvider: "stem-plus-ai-layered-render",
          generationMetadata: {
            status: "completed",
            grounding: "stem_plus_ai",
            estimatedCostUsd: 0.24,
            previousDrafts,
            output: { outputUri: "local://new.mp3" },
          },
        })}
      />,
    );
    expect(html).toContain("Previous versions");
    expect(html).toContain("AI drums replacement");
    expect(html).toContain("~$0.24"); // current draft's recorded cost
    expect(html).toContain("~$0.12"); // archived version's cost
  });

  it("shows no versions block when there is no history", () => {
    const html = renderToStaticMarkup(<RemixStudioEditor project={project()} />);
    expect(html).not.toContain("Previous versions");
  });

  it("states the preview-vs-render loudness gap honestly", () => {
    const html = renderToStaticMarkup(<RemixStudioEditor project={project()} />);
    expect(html).toContain("unmastered");
    expect(html).toContain("loudness-normalized");
  });
});

describe("Create + Drafts panels (#1879)", () => {
  it("selects Mix stems with the Render mix primary for a stem mix project", () => {
    const html = renderToStaticMarkup(<RemixStudioEditor project={project()} />);
    expect(html).toContain("remix-create-panel");
    expect(html).toMatch(/aria-pressed="true"[^>]*remix-create-switch-mix/);
    expect(html).toMatch(/aria-pressed="false"[^>]*remix-create-switch-ai/);
    expect(html).toMatch(/remix-generate-btn[^>]*>Render mix<\/button>/);
  });

  it("checks Reimagine the track for a variation project", () => {
    const html = renderToStaticMarkup(
      <RemixStudioEditor project={project({ mode: "variation", prompt: "darker" })} />,
    );
    expect(html).toMatch(/aria-pressed="true"[^>]*remix-create-switch-ai/);
    expect(html).toContain("Reimagine the track");
    const checked = html.match(/<input[^>]*checked=""[^>]*>/g) ?? [];
    expect(checked).toHaveLength(1);
    expect(checked[0]).toContain('value="reimagine"');
    expect(html).toMatch(/remix-generate-btn[^>]*>Generate AI draft<\/button>/);
  });

  it("shows the empty drafts hint before any draft", () => {
    const html = renderToStaticMarkup(<RemixStudioEditor project={project()} />);
    expect(html).toContain("remix-draft-empty");
    expect(html).toContain("No draft yet. Render your arranged stems into a mix");
  });

  it("renders a completed stem mix draft with its chip and Publish", () => {
    const html = renderToStaticMarkup(
      <RemixStudioEditor
        project={project({
          generationJobId: "rmxgen_stemmix_1",
          generationProvider: "stem-mix-render",
          generationMetadata: {
            status: "completed",
            mode: "stem_mix",
            grounding: "stem_audio",
            output: { outputUri: "local://mix.mp3" },
          },
        })}
      />,
    );
    expect(html).toContain("Stem mix render");
    expect(html).toContain("Your stems only");
    expect(html).toContain("Publish on Resonate");
    expect(html).toContain("remix-action-publish");
    expect(html).toMatch(/remix-generate-btn[^>]*>Re-render mix<\/button>/);
  });

  it("never renders job ids or the policy version", () => {
    const html = renderToStaticMarkup(
      <RemixStudioEditor
        project={project({
          mode: "variation",
          generationJobId: "rmxgen_secret_job",
          generationProvider: "stem-plus-ai-layered-render",
          generationMetadata: {
            status: "completed",
            grounding: "stem_plus_ai",
            previousDrafts: [
              {
                jobId: "rmxgen_secret_old",
                provider: "stem-plus-ai-layered-render",
                mode: "variation",
                grounding: "stem_plus_ai",
                stemTransform: null,
                estimatedCostUsd: 0.12,
                completedAt: null,
                output: { outputUri: "local://old.mp3", mimeType: null },
              },
            ],
            output: { outputUri: "local://new.mp3" },
          },
        })}
      />,
    );
    expect(html).not.toContain("rmxgen_secret");
    expect(html).not.toContain("2026-06-09.v1");
    expect(html).not.toMatch(/policy/i);
  });
});

describe("saved AI target (#1882)", () => {
  it("restores the saved variation target when switching back from Mix", () => {
    const addLayer = { kind: "add_layer" as const };
    const replace = { kind: "replace_stem" as const };
    const whole = { kind: "whole" as const };
    expect(intentReturningFromMix("stem_mix", addLayer, "reimagine")).toBe("add_part");
    expect(intentReturningFromMix("stem_mix", replace, "reimagine")).toBe("replace_stem");
    expect(intentReturningFromMix("stem_mix", whole, "reimagine")).toBe("reimagine");
    // Explicit picks inside Add AI, and non-mix starting points, pass through.
    expect(intentReturningFromMix("variation", addLayer, "reimagine")).toBe("reimagine");
    expect(intentReturningFromMix("stem_mix", addLayer, "extend")).toBe("extend");
  });

  it("initialEdits restores a saved replace_stem target with its stem", () => {
    const edits = initialEdits(
      project({
        mode: "variation",
        aiTarget: { kind: "replace_stem", stemId: "stem-2" },
      }),
    );
    expect(edits.aiTarget).toEqual({ kind: "replace_stem", stemId: "stem-2" });
  });

  it("defaults to the whole track when absent or null", () => {
    expect(initialEdits(project()).aiTarget).toEqual({
      kind: "whole",
      stemId: null,
    });
    expect(initialEdits(project({ aiTarget: null })).aiTarget).toEqual({
      kind: "whole",
      stemId: null,
    });
  });

  it("falls back safely on malformed saved targets", () => {
    const stems = project().stems;
    expect(normalizeAiTarget({ kind: "remaster", stemId: "stem-1" }, stems)).toEqual({
      kind: "whole",
      stemId: null,
    });
    expect(normalizeAiTarget("replace_stem", stems)).toEqual({
      kind: "whole",
      stemId: null,
    });
    // A stem no longer in the project is dropped, not trusted.
    expect(
      normalizeAiTarget({ kind: "replace_stem", stemId: "stem-gone" }, stems),
    ).toEqual({ kind: "replace_stem", stemId: null });
    // Only replace_stem carries a stem.
    expect(
      normalizeAiTarget({ kind: "add_layer", stemId: "stem-1" }, stems),
    ).toEqual({ kind: "add_layer", stemId: null });
    // A malformed persisted target round-trips without a spurious patch.
    const stale = project({
      aiTarget: { kind: "replace_stem", stemId: "stem-gone" },
    });
    expect(buildProjectPatch(stale, initialEdits(stale))).toEqual({});
  });

  it("buildProjectPatch emits aiTarget only when it changed", () => {
    const p = project({ mode: "variation" });
    expect(buildProjectPatch(p, initialEdits(p))).toEqual({});

    const adding = {
      ...initialEdits(p),
      aiTarget: { kind: "add_layer" as const, stemId: null },
    };
    expect(buildProjectPatch(p, adding)).toEqual({
      aiTarget: { kind: "add_layer", stemId: null },
    });

    // Replace with no stem chosen yet is a valid saved state.
    const replacing = {
      ...initialEdits(p),
      aiTarget: { kind: "replace_stem" as const, stemId: null },
    };
    expect(buildProjectPatch(p, replacing)).toEqual({
      aiTarget: { kind: "replace_stem", stemId: null },
    });

    // Back to the whole track clears with null.
    const saved = project({
      mode: "variation",
      aiTarget: { kind: "replace_stem", stemId: "stem-1" },
    });
    const whole = {
      ...initialEdits(saved),
      aiTarget: { kind: "whole" as const, stemId: null },
    };
    expect(buildProjectPatch(saved, whole)).toEqual({ aiTarget: null });

    // Whole with a stray stem id is still the whole track.
    const wholeStray = {
      ...initialEdits(p),
      aiTarget: { kind: "whole" as const, stemId: "stem-1" },
    };
    expect(buildProjectPatch(p, wholeStray)).toEqual({});
  });

  it("renders a saved add_layer target as Add a new part", () => {
    const html = renderToStaticMarkup(
      <RemixStudioEditor
        project={project({
          mode: "variation",
          prompt: "darker",
          aiTarget: { kind: "add_layer", stemId: null },
        })}
      />,
    );
    const checked = html.match(/<input[^>]*checked=""[^>]*>/g) ?? [];
    expect(checked).toHaveLength(1);
    expect(checked[0]).toContain('value="add_part"');
  });

  it("renders a saved replace_stem target with the stem preselected", () => {
    const html = renderToStaticMarkup(
      <RemixStudioEditor
        project={project({
          mode: "variation",
          prompt: "darker",
          aiTarget: { kind: "replace_stem", stemId: "stem-2" },
        })}
      />,
    );
    const checked = html.match(/<input[^>]*checked=""[^>]*>/g) ?? [];
    expect(checked).toHaveLength(1);
    expect(checked[0]).toContain('value="replace_stem"');
    expect(html).toMatch(/<option[^>]*value="stem-2"[^>]*selected=""/);
  });
});

describe("structure blocks (#1899)", () => {
  const sectionGrid = {
    kind: "bars" as const,
    sections: [
      { startSec: 0, endSec: 16 },
      { startSec: 16, endSec: 32 },
      { startSec: 32, endSec: 48 },
      { startSec: 48, endSec: 64 },
    ],
    sectionSeconds: 16,
    durationSeconds: 64,
    bpm: 120,
  };
  const mask = (sections: boolean[]) => ({
    schemaVersion: "remix-stem-arrangement/v1",
    sections,
  });
  const repeated = {
    schemaVersion: REMIX_STRUCTURE_SCHEMA_VERSION,
    blocks: [{ section: 0 }, { section: 1 }, { section: 1 }, { section: 2 }, { section: 3 }],
  };

  function structured(overrides: Partial<RemixProject> = {}): RemixProject {
    const base = project({ sectionGrid, structure: repeated });
    base.stems[1].arrangement = mask([true, false, true, true, true]);
    return { ...base, ...overrides };
  }

  it("initialEdits parses masks against the block count", () => {
    const edits = initialEdits(structured());
    expect(edits.structure).toEqual(repeated);
    expect(edits.stems["stem-2"].sections).toEqual([true, false, true, true, true]);
    expect(projectStructure(structured()).blockCount).toBe(5);

    // A section-length (stale) mask on a 5-block project counts as all on.
    const stale = structured();
    stale.stems[1].arrangement = mask([true, false, true, true]);
    expect(initialEdits(stale).stems["stem-2"].sections).toBeNull();
    // ...and is not rewritten by an unrelated save.
    expect(buildProjectPatch(stale, initialEdits(stale))).toEqual({});

    // No structure: blocks are the sections, exactly as before.
    const plain = project({ sectionGrid });
    plain.stems[1].arrangement = mask([true, true, false, true]);
    expect(initialEdits(plain).structure).toBeNull();
    expect(initialEdits(plain).stems["stem-2"].sections).toEqual([
      true,
      true,
      false,
      true,
    ]);
    // The identity order normalizes to null.
    expect(
      initialEdits(
        project({
          sectionGrid,
          structure: {
            schemaVersion: REMIX_STRUCTURE_SCHEMA_VERSION,
            blocks: [0, 1, 2, 3].map((section) => ({ section })),
          },
        }),
      ).structure,
    ).toBeNull();
  });

  it("buildProjectPatch sends the structure with the remapped masks", () => {
    const plain = project({ sectionGrid });
    plain.stems[1].arrangement = mask([true, true, false, true]);
    const edits = initialEdits(plain);
    const result = blockActionResult(
      structureEditStateFor(sectionGrid, edits),
      2,
      "repeat",
      sectionGrid,
    )!;
    const next = editsWithStructure(edits, result);
    expect(buildProjectPatch(plain, next)).toEqual({
      structure: {
        schemaVersion: REMIX_STRUCTURE_SCHEMA_VERSION,
        blocks: [0, 1, 2, 2, 3].map((section) => ({ section })),
      },
      // The off column is copied with its block; the null mask stays null.
      stems: [{ stemId: "stem-2", arrangement: mask([true, true, false, false, true]) }],
    });
  });

  it("buildProjectPatch clears the structure and diffs masks against the persisted block count", () => {
    const saved = structured();
    const edits = initialEdits(saved);
    expect(buildProjectPatch(saved, edits)).toEqual({}); // round-trip clean

    // Removing the repeat restores the original order: structure null, and
    // stem-2's mask drops the removed column.
    const removed = editsWithStructure(
      edits,
      blockActionResult(
        structureEditStateFor(sectionGrid, edits),
        2,
        "remove",
        sectionGrid,
      )!,
    );
    expect(removed.structure).toBeNull();
    expect(buildProjectPatch(saved, removed)).toEqual({
      structure: null,
      stems: [{ stemId: "stem-2", arrangement: mask([true, false, true, true]) }],
    });

    // A fade leaves every mask alone.
    const faded = editsWithStructure(
      edits,
      blockActionResult(
        structureEditStateFor(sectionGrid, edits),
        4,
        "fade_out",
        sectionGrid,
      )!,
    );
    const patch = buildProjectPatch(saved, faded);
    expect(patch.structure?.blocks[4]).toEqual({ section: 3, fadeOut: true });
    expect(patch.stems).toBeUndefined();
  });

  it("a structure change clears a stale persisted mask", () => {
    // stem-2 holds a 4-long mask on a 5-block project: stale (reads all on).
    const stale = structured();
    stale.stems[1].arrangement = mask([true, false, false, true]);
    const edits = initialEdits(stale);
    expect(edits.stems["stem-2"].sections).toBeNull();
    // Removing a block makes the count 4 — the stale mask's length — so it
    // is cleared explicitly instead of coming back to life.
    const removed = editsWithStructure(
      edits,
      blockActionResult(
        structureEditStateFor(sectionGrid, edits),
        2,
        "remove",
        sectionGrid,
      )!,
    );
    expect(buildProjectPatch(stale, removed)).toEqual({
      structure: null,
      stems: [{ stemId: "stem-2", arrangement: null }],
    });
    // Also cleared by a structure change that keeps the count (a fade).
    const faded = editsWithStructure(
      edits,
      blockActionResult(
        structureEditStateFor(sectionGrid, edits),
        0,
        "fade_in",
        sectionGrid,
      )!,
    );
    expect(buildProjectPatch(stale, faded).stems).toEqual([
      { stemId: "stem-2", arrangement: null },
    ]);
  });

  it("a structure change does not re-send a valid mask the edit keeps", () => {
    const saved = structured();
    const edits = initialEdits(saved);
    const faded = editsWithStructure(
      edits,
      blockActionResult(
        structureEditStateFor(sectionGrid, edits),
        0,
        "fade_in",
        sectionGrid,
      )!,
    );
    const patch = buildProjectPatch(saved, faded);
    expect(patch.structure).toBeDefined();
    expect(patch.stems).toBeUndefined();
  });

  it("stemPreviewStates gates by block in timeline time", () => {
    const proj = structured();
    const states = stemPreviewStates(proj, initialEdits(proj));
    // Blocks: 0–16 (s0), 16–32 (s1, off), 32–48 (s1 again, on), 48–64, 64–80.
    expect(states.find((state) => state.stemId === "stem-2")!.activeIntervals).toEqual([
      { startSec: 0, endSec: 16 },
      { startSec: 32, endSec: 80 },
    ]);
    expect(states.find((state) => state.stemId === "stem-1")!.activeIntervals).toBeNull();
    expect(editsTimeline(proj, initialEdits(proj))!.durationSec).toBe(80);
    expect(editsTimeline(project(), initialEdits(project()))).toBeNull();
  });

  it("names a block loop after its source section", () => {
    expect(transportLoopLabel(sectionGrid, 2, repeated.blocks)).toBe(
      "Looping bar 9",
    );
    expect(transportLoopLabel(sectionGrid, 4, repeated.blocks)).toBe(
      "Looping bar 25",
    );
    expect(transportLoopLabel(sectionGrid, 5, repeated.blocks)).toBeNull();
  });

  it("renders block columns, the repeat mark, section menus and the shape options", () => {
    const html = renderToStaticMarkup(<RemixStudioEditor project={structured()} />);
    expect(html).toContain('aria-label="Drums: section 5 on"');
    expect(html).toContain('aria-label="Drums: section 2 off"');
    expect(html).toContain('aria-label="Drums: section 3 on"');
    expect(html).toContain('title="Repeat of bar 9"');
    expect(html).toContain('aria-label="Section options for bar 9 (repeat)"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain("Song length &amp; shape");
    expect(html).toContain("1:20 → 1:04"); // back to the original length
  });

  it("locks the section menus and shapes on a published remix", () => {
    const html = renderToStaticMarkup(
      <RemixStudioEditor project={structured({ status: "published" })} />,
    );
    expect(html).toMatch(/aria-label="Section options for bar 1"[^>]*disabled=""/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*remix-structure-shape-original/);
  });
});

describe("Describe it (#1900)", () => {
  const sectionGrid = {
    kind: "bars" as const,
    sections: [0, 16, 32, 48].map((startSec) => ({ startSec, endSec: startSec + 16 })),
    sectionSeconds: 16,
    durationSeconds: 64,
    bpm: 120,
  };

  it("applyDescribedEdits sets mutes, masks, effects and structure in one update", () => {
    const edits = { ...initialEdits(project({ sectionGrid })), title: "Typed meanwhile" };
    const effects = { schemaVersion: REMIX_FX_SCHEMA_VERSION, master: { speed: 0.85 } };
    const structure = {
      schemaVersion: REMIX_STRUCTURE_SCHEMA_VERSION,
      blocks: [0, 1, 2].map((section) => ({ section })),
    };
    const next = applyDescribedEdits(edits, {
      stems: {
        "stem-1": { gainDb: 6, muted: true, sections: [true, false, true] },
        "stem-2": { gainDb: null, muted: false, sections: null },
        "stem-gone": { gainDb: null, muted: true, sections: null },
      },
      effects,
      structure,
    });
    expect(next.title).toBe("Typed meanwhile");
    expect(next.prompt).toBe(edits.prompt);
    expect(next.aiTarget).toBe(edits.aiTarget);
    // Gains stay the listener's own; unknown stems are ignored.
    expect(next.stems).toEqual({
      "stem-1": { gainDb: -3, muted: true, sections: [true, false, true] },
      "stem-2": { gainDb: null, muted: false, sections: null },
    });
    expect(next.effects).toBe(effects);
    expect(next.structure).toBe(structure);
    expect(buildProjectPatch(project({ sectionGrid }), next)).toMatchObject({
      effects,
      structure,
    });
  });

  it("renders the Describe box in the studio and locks it once published", () => {
    const html = renderToStaticMarkup(<RemixStudioEditor project={project({ sectionGrid })} />);
    expect(html).toContain("Describe the remix you want");
    expect(html).toMatch(/<input(?![^>]*disabled="")[^>]*remix-describe-input/);
    const published = renderToStaticMarkup(
      <RemixStudioEditor project={project({ sectionGrid, status: "published" })} />,
    );
    expect(published).toMatch(/<input[^>]*disabled=""[^>]*remix-describe-input/);
  });
});

describe("beat maker (#1902)", () => {
  const sectionGrid = {
    kind: "bars" as const,
    sections: [0, 16, 32, 48].map((startSec) => ({ startSec, endSec: startSec + 16 })),
    sectionSeconds: 16,
    durationSeconds: 64,
    bpm: 120,
  };
  const beat = defaultBeat("boom_bap");

  it("initialEdits normalizes the saved beat against the block count", () => {
    expect(initialEdits(project({ sectionGrid })).beat).toBeNull();
    const saved = project({
      sectionGrid,
      beat: { ...beat, swing: 0.9, blocks: [true, false, true, true] },
    });
    expect(initialEdits(saved).beat).toEqual({
      ...beat,
      swing: 0.6,
      blocks: [true, false, true, true],
    });
    // A stale mask plays in every block and is not rewritten by a save.
    const stale = project({ sectionGrid, beat: { ...beat, blocks: [false, true] } });
    expect(initialEdits(stale).beat?.blocks).toBeNull();
    expect(buildProjectPatch(stale, initialEdits(stale))).toEqual({});
  });

  it("buildProjectPatch sends the whole beat, or null to remove it", () => {
    const plain = project({ sectionGrid });
    expect(buildProjectPatch(plain, { ...initialEdits(plain), beat })).toEqual({ beat });
    const withBeat = project({ sectionGrid, beat });
    const edits = initialEdits(withBeat);
    expect(buildProjectPatch(withBeat, edits)).toEqual({});
    expect(
      buildProjectPatch(withBeat, { ...edits, beat: { ...beat, kit: "808" } }),
    ).toEqual({ beat: { ...beat, kit: "808" } });
    expect(buildProjectPatch(withBeat, { ...edits, beat: null })).toEqual({
      beat: null,
    });
  });

  it("structure edits remap the beat's blocks in the same update", () => {
    const withBeat = project({
      sectionGrid,
      beat: { ...beat, blocks: [true, false, true, true] },
    });
    const edits = initialEdits(withBeat);
    const next = editsAfterStructureOp(edits, sectionGrid, (state) =>
      blockActionResult(state, 1, "repeat", sectionGrid),
    );
    expect(next.beat?.blocks).toEqual([true, false, false, true, true]);
    expect(next.structure?.blocks.map((block) => block.section)).toEqual([
      0, 1, 1, 2, 3,
    ]);
    expect(buildProjectPatch(withBeat, next)).toMatchObject({
      structure: next.structure,
      beat: { ...beat, blocks: [true, false, false, true, true] },
    });
    // A refused op changes nothing.
    expect(
      editsAfterStructureOp(edits, sectionGrid, (state) =>
        blockActionResult(state, 0, "earlier", sectionGrid),
      ),
    ).toBe(edits);
    // No beat: the structure op runs as before.
    const noBeat = initialEdits(project({ sectionGrid }));
    expect(
      editsAfterStructureOp(noBeat, sectionGrid, (state) =>
        blockActionResult(state, 0, "remove", sectionGrid),
      ).beat,
    ).toBeNull();
  });

  it("a structure change clears a stale persisted beat mask", () => {
    const stale = project({
      sectionGrid,
      beat: { ...beat, blocks: [false, true, true, true, true] },
    });
    const edits = initialEdits(stale);
    const next = editsAfterStructureOp(edits, sectionGrid, (state) =>
      blockActionResult(state, 0, "repeat", sectionGrid),
    );
    expect(buildProjectPatch(stale, next).beat).toEqual({ ...beat, blocks: null });
  });

  it("Describe it leaves the beat alone", () => {
    const edits = initialEdits(project({ sectionGrid, beat }));
    const next = applyDescribedEdits(edits, {
      stems: {},
      effects: null,
      structure: null,
    });
    expect(next.beat).toBe(edits.beat);
  });

  it("builds the preview beat over the edited timeline (bar grids only)", () => {
    const edits = initialEdits(project({ sectionGrid, beat }));
    const preview = editsPreviewBeat({ sectionGrid }, edits);
    expect(preview?.recipe).toEqual(normalizeRemixBeat(beat, 4));
    expect(preview?.segments).toHaveLength(4);
    expect(editsPreviewBeat({ sectionGrid }, { ...edits, beat: null })).toBeNull();
    expect(
      editsPreviewBeat({ sectionGrid: { ...sectionGrid, kind: "time" } }, edits),
    ).toBeNull();
    expect(
      editsPreviewBeat({ sectionGrid: { ...sectionGrid, bpm: null } }, edits),
    ).toBeNull();
  });

  it("renders the Beat lane and the Add a beat section", () => {
    const none = renderToStaticMarkup(<RemixStudioEditor project={project({ sectionGrid })} />);
    expect(none).toContain("Add a beat");
    expect(none).not.toContain("remix-lane-beat");
    const html = renderToStaticMarkup(
      <RemixStudioEditor project={project({ sectionGrid, beat })} />,
    );
    expect(html).toContain("remix-lane-beat");
    expect(html).toContain("Punchy kit");
    expect(html).toContain("Remove beat");
    // No bar grid: an honest note, no lane.
    const timeGrid = renderToStaticMarkup(
      <RemixStudioEditor
        project={project({ sectionGrid: { ...sectionGrid, kind: "time", bpm: null }, beat })}
      />,
    );
    expect(timeGrid).toContain("needs a measured tempo");
    expect(timeGrid).not.toContain("remix-lane-beat");
  });
});

describe("beat mute persists (#1902)", () => {
  const sectionGrid = {
    kind: "bars" as const,
    sections: [0, 16].map((startSec) => ({ startSec, endSec: startSec + 16 })),
    sectionSeconds: 16,
    durationSeconds: 32,
    bpm: 120,
  };
  const beat = defaultBeat("trap");

  it("autosaves the mute with the recipe, and unmute omits it", () => {
    const withBeat = project({ sectionGrid, beat });
    const edits = initialEdits(withBeat);
    const muted = { ...edits, beat: withBeatMuted(edits.beat!, true) };
    expect(buildProjectPatch(withBeat, muted)).toEqual({
      beat: { ...beat, muted: true },
    });
    const saved = project({ sectionGrid, beat: { ...beat, muted: true } });
    expect(initialEdits(saved).beat?.muted).toBe(true);
    const unmuted = {
      ...initialEdits(saved),
      beat: withBeatMuted(initialEdits(saved).beat!, false),
    };
    const patch = buildProjectPatch(saved, unmuted);
    expect(patch).toEqual({ beat });
    expect("muted" in (patch.beat ?? {})).toBe(false);
  });

  it("the preview beat carries the mute and the lane shows it", () => {
    const saved = project({ sectionGrid, beat: { ...beat, muted: true } });
    expect(editsPreviewBeat(saved, initialEdits(saved))?.recipe.muted).toBe(true);
    const html = renderToStaticMarkup(<RemixStudioEditor project={saved} />);
    const row = html.slice(html.indexOf('data-stem-id="remix-beat"'));
    expect(row).toMatch(/aria-pressed="true"[^>]*aria-label="Mute Beat"/);
    expect(row).toContain("remix-lane-row-dimmed");
  });
});

describe("Reset to original (#1910)", () => {
  const sectionGrid = {
    kind: "bars" as const,
    sections: [0, 16, 32, 48].map((startSec) => ({ startSec, endSec: startSec + 16 })),
    sectionSeconds: 16,
    durationSeconds: 64,
    bpm: 120,
  };
  const mask = (sections: boolean[]) => ({
    schemaVersion: "remix-stem-arrangement/v1",
    sections,
  });

  /** A remixed project: effects, a shape, a beat, stem changes, a reference. */
  function remixed(overrides: Partial<RemixProject> = {}): RemixProject {
    const base = project({
      sectionGrid,
      prompt: "darker",
      effects: {
        schemaVersion: REMIX_FX_SCHEMA_VERSION,
        master: { space: 0.4 },
      },
      structure: {
        schemaVersion: REMIX_STRUCTURE_SCHEMA_VERSION,
        blocks: [{ section: 0 }, { section: 0 }, { section: 1 }, { section: 2 }, { section: 3 }],
      },
      beat: defaultBeat("boom_bap"),
    });
    base.stems = [
      {
        stemId: "stem-original",
        type: "original",
        title: null,
        role: null,
        gainDb: -6,
        muted: true,
        arrangement: null,
      },
      { ...base.stems[0], arrangement: mask([true, false, true, true, true]) },
      base.stems[1],
    ];
    return { ...base, ...overrides };
  }

  /** A project that already sounds like the source. */
  function pristine(overrides: Partial<RemixProject> = {}): RemixProject {
    const base = project();
    base.stems = base.stems.map((stem) => ({ ...stem, gainDb: null, muted: false }));
    return { ...base, ...overrides };
  }

  it("clears effects, shape, beat and every separated stem's changes", () => {
    const p = remixed();
    const edits = initialEdits(p);
    expect(edits.effects).not.toBeNull();
    expect(edits.structure).not.toBeNull();
    expect(edits.beat).not.toBeNull();
    const refs = referenceStemIds(p.stems);
    const reset = originalEdits(edits, refs);
    expect(reset.effects).toBeNull();
    expect(reset.structure).toBeNull();
    expect(reset.beat).toBeNull();
    expect(reset.stems["stem-1"]).toEqual({ muted: false, gainDb: null, sections: null });
    expect(reset.stems["stem-2"]).toEqual({ muted: false, gainDb: null, sections: null });
    // The full-mix reference is untouched: still muted, reference only.
    expect(reset.stems["stem-original"]).toBe(edits.stems["stem-original"]);
    expect(reset.stems["stem-original"].muted).toBe(true);
    expect(reset.stems["stem-original"].gainDb).toBe(-6);
    // Not sound: title, prompt, mode and AI target are kept.
    expect(reset.title).toBe(edits.title);
    expect(reset.prompt).toBe("darker");
    expect(reset.mode).toBe(edits.mode);
    expect(reset.aiTarget).toBe(edits.aiTarget);
    // The input is not mutated.
    expect(edits.effects).not.toBeNull();
  });

  it("saves as one patch that leaves the reference alone", () => {
    const p = remixed();
    const patch = buildProjectPatch(
      p,
      originalEdits(initialEdits(p), referenceStemIds(p.stems)),
    );
    expect(patch.effects).toBeNull();
    expect(patch.structure).toBeNull();
    expect(patch.beat).toBeNull();
    expect(patch.stems).toEqual([
      { stemId: "stem-1", gainDb: null, arrangement: null },
      { stemId: "stem-2", muted: false },
    ]);
    expect(patch.title).toBeUndefined();
    expect(patch.prompt).toBeUndefined();
  });

  it("knows when the edits already sound like the original", () => {
    const p = remixed();
    const refs = referenceStemIds(p.stems);
    const edits = initialEdits(p);
    expect(editsAreOriginal(edits, refs)).toBe(false);
    const reset = originalEdits(edits, refs);
    expect(editsAreOriginal(reset, refs)).toBe(true);
    // A 0 dB gain and an all-on mask sound the same as none.
    expect(
      editsAreOriginal(
        {
          ...reset,
          stems: {
            ...reset.stems,
            "stem-1": { muted: false, gainDb: 0, sections: [true, true, true, true] },
          },
        },
        refs,
      ),
    ).toBe(true);
    // Any real change is not the original.
    const change = (stem: Partial<{ muted: boolean; gainDb: number; sections: boolean[] }>) =>
      editsAreOriginal(
        { ...reset, stems: { ...reset.stems, "stem-2": { ...reset.stems["stem-2"], ...stem } } },
        refs,
      );
    expect(change({ muted: true })).toBe(false);
    expect(change({ gainDb: -2 })).toBe(false);
    expect(change({ sections: [true, false, true, true] })).toBe(false);
    expect(editsAreOriginal({ ...reset, beat: defaultBeat("boom_bap") }, refs)).toBe(false);
    expect(
      editsAreOriginal(
        { ...reset, effects: { schemaVersion: REMIX_FX_SCHEMA_VERSION, master: { tone: 0.5 } } },
        refs,
      ),
    ).toBe(false);
    // The reference's own state never matters.
    expect(
      editsAreOriginal(
        {
          ...reset,
          stems: { ...reset.stems, "stem-original": { muted: true, gainDb: -12, sections: null } },
        },
        refs,
      ),
    ).toBe(true);
  });

  it("is locked when published, off when already original, else available", () => {
    expect(describeResetAvailability({ published: true, original: false })).toEqual({
      enabled: false,
      reason: "Published remixes are locked",
    });
    expect(describeResetAvailability({ published: false, original: true })).toEqual({
      enabled: false,
      reason: "Already the original",
    });
    expect(describeResetAvailability({ published: false, original: false })).toEqual({
      enabled: true,
      reason: null,
    });
  });

  it("confirms with honest copy", () => {
    expect(RESET_ORIGINAL_CONFIRM_TITLE).toBe("Reset to the original?");
    expect(RESET_ORIGINAL_CONFIRM_MESSAGE).toBe(
      "This clears your effects, song shape, beat and stem changes. Your drafts are kept.",
    );
  });

  function resetButton(html: string): string {
    return html.match(/<button[^>]*remix-reset-original-btn[^>]*>[\s\S]*?<\/button>/)?.[0] ?? "";
  }

  it("offers Reset to original in the Session header when there are changes", () => {
    const button = resetButton(
      renderToStaticMarkup(<RemixStudioEditor project={remixed()} />),
    );
    expect(button).toContain("Reset to original");
    expect(button).not.toContain("aria-disabled");
    expect(button).toContain("ui-btn-ghost");
  });

  it("explains why Reset is unavailable", () => {
    const original = resetButton(
      renderToStaticMarkup(<RemixStudioEditor project={pristine()} />),
    );
    expect(original).toContain('aria-disabled="true"');
    expect(original).toContain('title="Already the original"');
    expect(original).toContain("Already the original");

    const locked = resetButton(
      renderToStaticMarkup(
        <RemixStudioEditor project={remixed({ status: "published" })} />,
      ),
    );
    expect(locked).toContain('aria-disabled="true"');
    expect(locked).toContain("Published remixes are locked");
  });
});

describe("listening volume + draft deletes in the studio (#1910)", () => {
  it("puts the listening volume in the transport", () => {
    const html = renderToStaticMarkup(<RemixStudioEditor project={project()} />);
    expect(html).toContain("remix-transport-volume");
    expect(html).toContain('aria-label="Volume"');
    expect(html).toContain('aria-label="Mute"');
  });

  const withVersions = (overrides: Partial<RemixProject> = {}) =>
    project({
      mode: "variation",
      generationJobId: "rmxgen_new",
      generationProvider: "stem-plus-ai-layered-render",
      generationMetadata: {
        status: "completed",
        grounding: "stem_plus_ai",
        output: { outputUri: "local://new.mp3" },
        previousDrafts: [
          {
            jobId: "rmxgen_old",
            provider: "stem-plus-ai-layered-render",
            mode: "variation",
            grounding: "stem_plus_ai",
            stemTransform: null,
            estimatedCostUsd: 0.12,
            completedAt: "2026-07-01T10:00:00.000Z",
            output: { outputUri: "local://old.mp3", mimeType: "audio/mpeg" },
          },
        ],
      },
      ...overrides,
    });

  it("offers delete on previous versions only", () => {
    const html = renderToStaticMarkup(<RemixStudioEditor project={withVersions()} />);
    expect(html.match(/remix-draft-version-delete/g) ?? []).toHaveLength(1);
    expect(html).toContain('aria-label="Delete version from');
  });

  it("hides delete under the published lock", () => {
    const html = renderToStaticMarkup(
      <RemixStudioEditor
        project={withVersions({ status: "published", publishedReleaseId: "rel-p" })}
      />,
    );
    expect(html).not.toContain("remix-draft-version-delete");
  });
});
