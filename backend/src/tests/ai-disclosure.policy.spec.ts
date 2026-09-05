import {
  AI_DISCLOSURE_VERSION,
  deriveReleaseAiDisclosureSummary,
  deriveRemixAiDisclosure,
  isPromotionEligible,
  normalizeAiDisclosureInput,
  toAiDisclosureRecord,
  toDdexContainsAi,
} from "../modules/catalog/ai-disclosure.policy";

describe("AI disclosure policy", () => {
  it("accepts the lowercase public contract and normalizes it for persistence", () => {
    expect(
      normalizeAiDisclosureInput({
        level: "partly",
        facets: ["vocals", "production", "vocals"],
      }),
    ).toEqual({ level: "PARTLY", facets: ["vocals", "production"] });
  });

  it.each([
    [{ level: "none", facets: ["vocals"] }, "cannot include"],
    [{ level: "partly", facets: [] }, "at least one"],
    [{ level: "undeclared", facets: [] }, "reserved for legacy"],
    [{ level: "all", facets: ["prompt"] }, "Unsupported"],
  ])("rejects an invalid declaration", (input, message) => {
    expect(() => normalizeAiDisclosureInput(input)).toThrow(message);
  });

  it("maps persisted disclosure to the lowercase public and DDEX shape", () => {
    expect(
      toAiDisclosureRecord({
        aiDisclosureLevel: "ALL",
        aiContributionFacets: ["composition_lyrics"],
        aiDisclosureSource: "resonate_native",
        aiDisclosureVersion: AI_DISCLOSURE_VERSION,
        aiDeclaredAt: new Date("2026-08-09T12:00:00.000Z"),
      }),
    ).toEqual({
      level: "all",
      facets: ["composition_lyrics"],
      source: "resonate_native",
      schemaVersion: AI_DISCLOSURE_VERSION,
      declaredAt: "2026-08-09T12:00:00.000Z",
      containsAI: "All",
      label: "Fully AI-generated",
    });
    expect(toDdexContainsAi("UNDECLARED")).toBeNull();
  });

  it("derives one partly disclosure for a mixed release and unions facets", () => {
    expect(
      deriveReleaseAiDisclosureSummary([
        {
          aiDisclosureLevel: "NONE",
          aiContributionFacets: [],
          aiDisclosureSource: "artist",
          aiDisclosureVersion: AI_DISCLOSURE_VERSION,
          aiDeclaredAt: new Date("2026-08-09T10:00:00.000Z"),
        },
        {
          aiDisclosureLevel: "ALL",
          aiContributionFacets: ["vocals"],
          aiDisclosureSource: "artist",
          aiDisclosureVersion: AI_DISCLOSURE_VERSION,
          aiDeclaredAt: new Date("2026-08-09T11:00:00.000Z"),
        },
      ]),
    ).toMatchObject({
      level: "partly",
      facets: ["vocals"],
      source: "artist",
      schemaVersion: AI_DISCLOSURE_VERSION,
      declaredAt: "2026-08-09T11:00:00.000Z",
      containsAI: "Partly",
    });
  });

  it("keeps NONE plus UNDECLARED honest instead of calling it AI-assisted", () => {
    expect(
      deriveReleaseAiDisclosureSummary([
        { aiDisclosureLevel: "NONE", aiContributionFacets: [] },
        { aiDisclosureLevel: "UNDECLARED", aiContributionFacets: [] },
      ]),
    ).toMatchObject({
      level: "undeclared",
      containsAI: null,
      facets: [],
      label: "AI disclosure unavailable",
    });
  });

  it("only excludes fully AI-generated tracks from promotion", () => {
    expect(isPromotionEligible("NONE")).toBe(true);
    expect(isPromotionEligible("PARTLY")).toBe(true);
    expect(isPromotionEligible("UNDECLARED")).toBe(true);
    expect(isPromotionEligible("ALL")).toBe(false);
  });

  it.each([
    ["stem_audio", { level: "NONE", facets: [] }],
    ["stem_plus_ai", { level: "PARTLY", facets: ["production"] }],
    ["audio_conditioned", { level: "PARTLY", facets: ["production"] }],
    ["feature_conditioned", { level: "PARTLY", facets: ["production"] }],
    ["prompt_only", { level: "ALL", facets: [] }],
  ])("derives %s remix disclosure", (grounding, expected) => {
    expect(deriveRemixAiDisclosure(grounding)).toEqual(expected);
  });
});
