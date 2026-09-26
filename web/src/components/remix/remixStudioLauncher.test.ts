import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RemixEligibilityResponse, RemixProject } from "../../lib/api";

const mocks = vi.hoisted(() => ({
  getRemixEligibility: vi.fn(),
  listRemixProjects: vi.fn(),
  createRemixProject: vi.fn(),
}));

vi.mock("../../lib/api", () => mocks);

import { launchRemixStudio, remixDenialReason } from "./remixStudioLauncher";

const allowed: RemixEligibilityResponse = {
  allowed: true,
  requiredLicense: null,
  allowedActions: ["private_draft"],
  reasons: [],
  policyVersion: "v1",
  source: { trackId: "trk-1", rightsRoute: null, contentStatus: "published" },
  stems: [
    { stemId: "stem-1", remixable: true, licensed: true },
    { stemId: "stem-2", remixable: false, licensed: true },
    { stemId: "stem-3", remixable: true, licensed: false },
  ],
};

const draft = (id: string, createdAt: string) =>
  ({ id, status: "draft", sourceTrackId: "trk-1", createdAt, stems: [] }) as unknown as RemixProject;

describe("launchRemixStudio", () => {
  beforeEach(() => {
    mocks.getRemixEligibility.mockReset();
    mocks.listRemixProjects.mockReset();
    mocks.createRemixProject.mockReset();
  });

  it("reuses the most recent matching draft", async () => {
    mocks.getRemixEligibility.mockResolvedValue(allowed);
    mocks.listRemixProjects.mockResolvedValue([
      draft("old", "2026-01-01T00:00:00Z"),
      draft("new", "2026-02-01T00:00:00Z"),
    ]);

    const result = await launchRemixStudio({ token: "t", trackId: "trk-1", trackTitle: "Signal" });

    expect(result).toEqual({ kind: "opened", path: "/remix/studio/new" });
    expect(mocks.createRemixProject).not.toHaveBeenCalled();
  });

  it("creates a draft from licensed, remixable stems when none exists", async () => {
    mocks.getRemixEligibility.mockResolvedValue(allowed);
    mocks.listRemixProjects.mockResolvedValue([]);
    mocks.createRemixProject.mockResolvedValue({ id: "proj-9" });

    const result = await launchRemixStudio({ token: "t", trackId: "trk-1", trackTitle: "Signal" });

    expect(result).toEqual({ kind: "opened", path: "/remix/studio/proj-9" });
    expect(mocks.createRemixProject).toHaveBeenCalledWith("t", {
      sourceTrackId: "trk-1",
      stemIds: ["stem-1"],
      title: "Signal (Remix)",
    });
  });

  it("returns the denial reason instead of opening the studio", async () => {
    mocks.getRemixEligibility.mockResolvedValue({ ...allowed, allowed: false, requiredLicense: "remix" });

    const result = await launchRemixStudio({ token: "t", trackId: "trk-1" });

    expect(result.kind).toBe("not_allowed");
    expect(result.kind === "not_allowed" && result.reason).toMatch(/remix license/i);
    expect(mocks.listRemixProjects).not.toHaveBeenCalled();
  });

  it("fails closed when eligibility cannot be checked", async () => {
    mocks.getRemixEligibility.mockRejectedValue(new Error("offline"));

    const result = await launchRemixStudio({ token: "t", trackId: "trk-1" });

    expect(result).toEqual({ kind: "not_allowed", reason: remixDenialReason(null), eligibility: null });
  });
});
