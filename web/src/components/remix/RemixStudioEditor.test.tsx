import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { RemixProject } from "../../lib/api";
import {
  describeAvailableStemAction,
  describeGenerateAvailability,
  describePublishAvailability,
  generationErrorMessage,
  groundingDescription,
  publishConfirmMessage,
  buildProjectPatch,
  clampGainDb,
  classifyProjectLoadError,
  describeSourceRights,
  initialEdits,
  RemixStudioEditor,
  remixGenerationFailureMessage,
  remixGenerationIsActive,
  remixGenerationPlayableOutputUri,
  remixGenerationStatus,
  saveStatusLabel,
  stemPreviewStates,
  stemDisplayName,
  stemFeatureChips,
} from "./RemixStudioEditor";
import type { RemixEligibilityResponse } from "../../lib/api";
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
    // Publish is now live (#1196) but honestly gated when no completed draft
    // exists; export stays unavailable with its honest reason.
    expect(html).toContain("remix-action-publish");
    expect(html).toContain("Publish on Resonate");
    expect(html).toMatch(/remix-action-publish[^>]*aria-disabled="true"|aria-disabled="true"[^>]*remix-action-publish/);
    expect(html).toContain("remix-action-unavailable--export");
    expect(html).toContain("Export requires a license that explicitly grants export rights");
    // No completed draft yet, so the gated reason is shown.
    expect(html).toContain("wait for it to finish before publishing");
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
    expect(html).toContain("remix-action-view-release");
    // Publish CTA is replaced, not shown again.
    expect(html).not.toContain("remix-action-publish");
    // Save is disabled in the published state.
    expect(html).toMatch(/Save changes<\/button>/);
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

    expect(html).toContain("AI draft recorded");
    // Honest provenance line (#1181)
    expect(html).toContain("matched to the stems&#x27; measured 93 BPM, G minor");
    expect(html).toContain("does not hear the source audio");
    expect(html).toContain("Play AI draft");
    expect(html).not.toContain("Playback arrives with audio preview");
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

    expect(html).toContain("AI generation queued");
    expect(html).toContain("Queued...");
    expect(html).toContain("Generation is already queued");
    expect(html).not.toContain("Play AI draft");
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

    expect(html).toContain("AI generation failed");
    expect(html).toContain("The provider timed out.");
    expect(html).toContain("Retry generation");
    expect(html).not.toContain("Play AI draft");
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

  it("enables stem_mix without a prompt — render needs no direction (#1189)", () => {
    expect(
      describeGenerateAvailability({ ...base, mode: "stem_mix", prompt: "" }),
    ).toEqual({ enabled: true, reason: null });
  });

  it("explains blank prompt and unsaved edits", () => {
    expect(describeGenerateAvailability({ ...base, prompt: "  " }).reason).toContain(
      "Write a prompt",
    );
    expect(describeGenerateAvailability({ ...base, dirty: true }).reason).toContain(
      "Save your changes",
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

describe("stemFeatureChips (#1312)", () => {
  it("renders measured tempo and key as compact chips", () => {
    expect(
      stemFeatureChips({
        tempoBpm: 92.5,
        key: { tonic: "G", mode: "minor", confidence: 0.7 },
      }),
    ).toEqual(["93 BPM", "G minor"]);
  });

  it("makes no musical claims for missing or invalid measurements", () => {
    expect(stemFeatureChips(null)).toEqual([]);
    expect(stemFeatureChips(undefined)).toEqual([]);
    expect(stemFeatureChips({ tempoBpm: 0, key: null })).toEqual([]);
    expect(stemFeatureChips({ tempoBpm: Number.NaN })).toEqual([]);
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

  it("shows measured tempo/key chips on session stem rows", () => {
    const withFeatures = project();
    withFeatures.stems[0].audioFeatures = {
      tempoBpm: 120,
      key: { tonic: "A", mode: "major", confidence: 0.9 },
    };
    const html = renderToStaticMarkup(
      <RemixStudioEditor project={withFeatures} />,
    );
    expect(html).toContain("120 BPM");
    expect(html).toContain("A major");
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

  it("renders the arrangement grid with honest labels and pressed cells", () => {
    const html = renderToStaticMarkup(
      <RemixStudioEditor project={gridProject()} />,
    );
    expect(html).toContain("Arrangement");
    expect(html).toContain("8-bar sections · measured 120 BPM");
    expect(html).toContain("0:16"); // section start column label
    expect(html).toContain('aria-label="Drums: section 3 off"');
    expect(html).toContain('aria-label="Lead Vocal: section 3 on"');
  });

  it("hides the grid when the source has none", () => {
    const html = renderToStaticMarkup(<RemixStudioEditor project={project()} />);
    expect(html).not.toContain("Arrangement");
  });
});
