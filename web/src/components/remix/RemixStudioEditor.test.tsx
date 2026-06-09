import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { RemixProject } from "../../lib/api";
import {
  buildProjectPatch,
  clampGainDb,
  classifyProjectLoadError,
  describeSourceRights,
  initialEdits,
  RemixStudioEditor,
  saveStatusLabel,
  stemDisplayName,
} from "./RemixStudioEditor";
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
    expect(html).toContain("Solo is a preview-only control");
    // Publish/export are aria-disabled with honest reasons, not hidden.
    expect(html).toContain("remix-action-unavailable--publish");
    expect(html).toContain("remix-action-unavailable--export");
    expect(html).toContain("Publishing remixes inside Resonate is not available yet");
    expect(html).toContain("Export requires a license that explicitly grants export rights");
    expect(html).toMatch(/remix-action-unavailable--publish[^>]*aria-disabled="true"|aria-disabled="true"[^>]*remix-action-unavailable--publish/);
    expect(html).toContain("No AI draft yet");
    expect(html).toContain("All changes saved");
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
