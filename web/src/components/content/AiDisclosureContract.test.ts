import { describe, expect, it } from "vitest";
import { getAiDisclosureValidationIssue } from "../../lib/api";

describe("AI disclosure upload contract", () => {
  it("requires an explicit declaration for every new track", () => {
    expect(
      getAiDisclosureValidationIssue({ level: "undeclared", facets: [] }),
    ).toBe("declaration_required");
  });

  it("requires at least one contribution facet for AI-assisted music", () => {
    expect(
      getAiDisclosureValidationIssue({ level: "partly", facets: [] }),
    ).toBe("facets_required");
    expect(
      getAiDisclosureValidationIssue({ level: "partly", facets: ["production"] }),
    ).toBeNull();
  });

  it("accepts human-made and fully AI-generated declarations without facets", () => {
    expect(getAiDisclosureValidationIssue({ level: "none", facets: [] })).toBeNull();
    expect(getAiDisclosureValidationIssue({ level: "all", facets: [] })).toBeNull();
  });

  it("does not allow AI facets on a human-made declaration", () => {
    expect(
      getAiDisclosureValidationIssue({ level: "none", facets: ["vocals"] }),
    ).toBe("facets_not_allowed");
  });
});
