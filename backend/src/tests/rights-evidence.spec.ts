import { BadRequestException } from "@nestjs/common";
import {
  normalizeDisputeReportBundle,
  normalizeEvidenceBundleInput,
} from "../modules/rights/rights-evidence";

describe("rights evidence normalization", () => {
  it("adds a narrative statement to dispute report bundles", () => {
    const bundle = normalizeEvidenceBundleInput({
      subjectType: "dispute",
      subjectId: "dispute_123_31337",
      submittedByRole: "reporter",
      submittedByAddress: "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefabcd",
      purpose: "dispute_report",
      summary: "This content was published by the reporting artist first.",
      evidences: [
        {
          kind: "prior_publication",
          title: "Bandcamp original release",
          sourceUrl: "https://example.com/original-release",
          claimedRightsholder: "Meta Artist",
        },
      ],
    });

    expect(bundle.evidences).toHaveLength(2);
    expect(bundle.evidences[0].kind).toBe("prior_publication");
    expect(bundle.evidences[1].kind).toBe("narrative_statement");
    expect(bundle.evidences[1].description).toBe(
      "This content was published by the reporting artist first.",
    );
  });

  it("rejects dispute reports without a claimed rightsholder", () => {
    expect(() =>
      normalizeEvidenceBundleInput({
        subjectType: "dispute",
        subjectId: "dispute_123_31337",
        submittedByRole: "reporter",
        purpose: "dispute_report",
        summary: "The uploader does not own this work.",
        evidences: [
          {
            kind: "prior_publication",
            title: "Original upload",
            sourceUrl: "https://example.com/original",
          },
        ],
      }),
    ).toThrow(BadRequestException);
  });

  it("rejects unsupported primary evidence kinds for dispute reports", () => {
    expect(() =>
      normalizeEvidenceBundleInput({
        subjectType: "dispute",
        subjectId: "dispute_123_31337",
        submittedByRole: "reporter",
        purpose: "dispute_report",
        summary: "This should not be accepted as the primary proof.",
        evidences: [
          {
            kind: "internal_review_note",
            title: "Internal note",
            description: "Ops note",
            claimedRightsholder: "Meta Artist",
          },
        ],
      }),
    ).toThrow(BadRequestException);
  });

  it("normalizes a direct dispute-report helper payload", () => {
    const bundle = normalizeDisputeReportBundle(
      {
        tokenId: "42",
        reporterAddr: "0xabcDEFabcdefABCDEFabcdefABCDEFabcdefabcd",
        narrativeSummary: "The reporter controls the canonical artist profile.",
        primaryEvidence: {
          kind: "proof_of_control",
          title: "Official artist profile",
          sourceUrl: "https://example.com/artist-profile",
          claimedRightsholder: "Meta Artist",
          strength: "medium",
        },
      },
      "dispute_local_1",
    );

    expect(bundle.subjectType).toBe("dispute");
    expect(bundle.submittedByRole).toBe("reporter");
    expect(bundle.evidences.map((evidence) => evidence.kind)).toEqual([
      "proof_of_control",
      "narrative_statement",
    ]);
  });
});
