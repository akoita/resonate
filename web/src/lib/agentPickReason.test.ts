import { describe, expect, it } from "vitest";
import { humanPickReason } from "./agentPickReason";

describe("humanPickReason (#2056)", () => {
  it("tells a session that played every match apart from one nothing matches", () => {
    expect(humanPickReason("no_tracks")).toBe(
      "You've heard everything that fits this session. Try other filters or another quick start.",
    );
    expect(humanPickReason("no_tracks", "all_candidates_recently_played")).toContain("You've heard everything");
    expect(humanPickReason("no_tracks", "no_matching_taste_candidates")).toBe(
      "Nothing in the catalog matches this session's filters yet. Try other filters or another quick start.",
    );
    expect(humanPickReason("no_tracks", "empty_catalog")).toContain("Nothing in the catalog matches");
  });

  it("never shows a raw status code", () => {
    for (const status of ["no_tracks", "all_rejected"]) {
      expect(humanPickReason(status)).not.toMatch(/_/);
    }
    expect(humanPickReason("rejected", "budget_exceeded")).toBe("budget exceeded");
    expect(humanPickReason()).toBe("No runtime pick returned.");
  });
});
