import { describe, expect, it } from "vitest";
import { approvalStatusLabel } from "./remixApproval";
import { summarizeApproval } from "../components/remix/RemixApprovalPanel";
import {
  describeExportAvailability,
  describePublishAvailability,
  ARTIST_APPROVAL_NEEDED_REASON,
} from "../components/remix/RemixStudioEditor";

const artist = { id: "a1", displayName: "Nova" };
const row = (status: "pending" | "approved" | "declined", reason: string | null = null) => ({
  id: "r1",
  remixProjectId: "p1",
  versionKey: "v1",
  status,
  message: null,
  reason,
  createdAt: "2026-11-26T10:00:00Z",
  decidedAt: null,
  sourceArtist: artist,
});

describe("remix approval (#2682)", () => {
  it("labels cards", () => {
    expect(approvalStatusLabel({ status: "pending", versionAvailable: true })).toBe("Waiting for you");
    expect(approvalStatusLabel({ status: "pending", versionAvailable: false })).toBe("Replaced by the creator");
    expect(approvalStatusLabel({ status: "declined", versionAvailable: true })).toBe("Declined");
  });

  it("summarizes the creator's state", () => {
    const base = { requiredArtists: [artist], currentVersionKey: "v1", current: [], approved: false };
    expect(summarizeApproval(null).kind).toBe("none");
    expect(summarizeApproval({ ...base, requiredArtists: [] }).kind).toBe("none");
    expect(summarizeApproval({ ...base, currentVersionKey: null }).kind).toBe("no_version");
    expect(summarizeApproval(base).kind).toBe("not_asked");
    expect(summarizeApproval({ ...base, current: [row("pending")] }).kind).toBe("pending");
    expect(summarizeApproval({ ...base, current: [row("approved")], approved: true }).kind).toBe("approved");
    expect(summarizeApproval({ ...base, current: [row("declined", "Too close")] })).toEqual({
      kind: "declined",
      artist: "Nova",
      reason: "Too close",
    });
  });

  it("says publish and export wait for the artist", () => {
    const eligibility = {
      allowed: true,
      requiredLicense: null,
      allowedActions: ["private_draft" as const],
      reasons: [],
      policyVersion: "v8",
      source: { trackId: "t", rightsRoute: null, contentStatus: "clean" },
      stems: [],
      limits: [{ code: "artist_approval_required" as const, message: "" }],
    };
    const common = { status: "draft", generationStatus: "completed" as const, hasDraftOutput: true, dirty: false, eligibility };
    expect(describePublishAvailability({ ...common, publishing: false })).toMatchObject({
      enabled: false,
      reason: ARTIST_APPROVAL_NEEDED_REASON,
      reasonCode: "publish_needs_artist_approval",
    });
    expect(describeExportAvailability({ ...common, exporting: false }).reasonCode).toBe("export_needs_artist_approval");
  });
});
