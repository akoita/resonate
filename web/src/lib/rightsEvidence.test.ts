import { describe, expect, it } from "vitest";
import {
  formatRightsEvidenceKindLabel,
  formatRightsEvidenceVerificationStatusLabel,
  getCreatorRightsEvidenceOption,
  normalizeRightsEvidenceUrl,
  normalizeRightsEvidenceUrlList,
} from "./rightsEvidence";

describe("rightsEvidence", () => {
  it("labels creator evidence fields with rights-review semantics", () => {
    expect(getCreatorRightsEvidenceOption("legal_notice").label).toBe("Publishing authority");
    expect(formatRightsEvidenceKindLabel("prior_publication")).toBe("Prior distribution");
  });

  it("labels unreviewed evidence as submitted evidence", () => {
    expect(formatRightsEvidenceVerificationStatusLabel(undefined)).toBe("Submitted evidence");
    expect(formatRightsEvidenceVerificationStatusLabel("unverified")).toBe("Submitted evidence");
    expect(formatRightsEvidenceVerificationStatusLabel("verified")).toBe("Reviewer verified evidence");
  });

  it("normalizes supported evidence URLs", () => {
    expect(normalizeRightsEvidenceUrl("example.com/proof")).toBe("https://example.com/proof");
    expect(normalizeRightsEvidenceUrl("ipfs://bafy-proof")).toBe("ipfs://bafy-proof");
    expect(normalizeRightsEvidenceUrlList("example.com/a\n\nhttps://example.com/b")).toEqual([
      "https://example.com/a",
      "https://example.com/b",
    ]);
  });

  it("rejects unsupported evidence URL protocols", () => {
    expect(() => normalizeRightsEvidenceUrl("ftp://example.com/proof")).toThrow(
      "Please enter a valid URL",
    );
  });
});
