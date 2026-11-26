import { describe, expect, it } from "vitest";
import { formatRightsRoute } from "./rightsRoute";

describe("formatRightsRoute", () => {
  it("names every route without payout jargon", () => {
    for (const route of ["TRUSTED_FAST_PATH", "STANDARD_ESCROW", "LIMITED_MONITORING", "NEEDS_HUMAN_REVIEW", "QUARANTINED_REVIEW", "BLOCKED"]) {
      expect(formatRightsRoute(route)).not.toMatch(/escrow|fast path|quarantin/i);
    }
    expect(formatRightsRoute("STANDARD_ESCROW")).toBe("Cleared");
  });

  it("says a release was not checked yet when it has no route", () => {
    expect(formatRightsRoute(null)).toBe("Not checked yet");
  });

  it("falls back to title case for a route it does not know", () => {
    expect(formatRightsRoute("NEW_ROUTE")).toBe("New Route");
  });
});
