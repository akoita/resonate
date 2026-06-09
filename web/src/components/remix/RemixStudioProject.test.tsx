import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { RemixProject } from "../../lib/api";
import {
  classifyProjectLoadError,
  RemixStudioProjectView,
} from "./RemixStudioProject";
import RemixStudioStubPage from "../../app/remix/studio/[projectId]/page";

const mockUseAuth = vi.fn(() => ({ token: "jwt-token", login: vi.fn() }));

vi.mock("../auth/AuthProvider", () => ({
  useAuth: () => mockUseAuth(),
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
    stems: [
      { stemId: "stem-1", role: "lead", gainDb: -3, muted: false, arrangement: null },
      { stemId: "stem-2", role: null, gainDb: null, muted: true, arrangement: null },
    ],
    ...overrides,
  };
}

describe("classifyProjectLoadError", () => {
  it("maps 403 responses to the private-project state", () => {
    expect(classifyProjectLoadError("API 403: Forbidden")).toBe("forbidden");
  });

  it("maps 404 responses to the missing state", () => {
    expect(classifyProjectLoadError("API 404: Not Found")).toBe("missing");
  });

  it("maps anything else to a generic error", () => {
    expect(classifyProjectLoadError("API 500: boom")).toBe("error");
    expect(classifyProjectLoadError("")).toBe("error");
  });
});

describe("RemixStudioProjectView", () => {
  it("renders title, status, stems, and private-draft policy copy", () => {
    const html = renderToStaticMarkup(<RemixStudioProjectView project={project()} />);
    expect(html).toContain("Neon Drift (Remix)");
    expect(html).toContain("draft");
    expect(html).toContain("stem mix");
    expect(html).toContain("stem-1");
    expect(html).toContain("lead");
    expect(html).toContain("-3 dB");
    expect(html).toContain("muted");
    expect(html).toContain("2026-06-09.v1");
    expect(html).toContain(
      "publishing and export are not available yet",
    );
  });

  it("handles projects with no stems", () => {
    const html = renderToStaticMarkup(
      <RemixStudioProjectView project={project({ stems: [] })} />,
    );
    expect(html).toContain("No stems selected.");
  });
});

describe("RemixStudioStubPage", () => {
  it("prompts signed-out users to sign in without fetching", () => {
    mockUseAuth.mockReturnValueOnce({ token: null as unknown as string, login: vi.fn() });
    const html = renderToStaticMarkup(<RemixStudioStubPage />);
    expect(html).toContain("Sign in to open this remix project");
    expect(html).toContain("private drafts visible only to their creator");
  });

  it("shows the loading skeleton for signed-in users before the project resolves", () => {
    const html = renderToStaticMarkup(<RemixStudioStubPage />);
    expect(html).toContain("aria-busy");
    expect(html).toContain("animate-pulse");
  });
});
