import { describe, expect, it } from "vitest";
import { ApiRequestError } from "./api";
import { campaignMode, interestConfirmation, interestSummaryLine, showInterestErrorMessage } from "./showInterest";

describe("show interest copy (#2668)", () => {
  it("treats anything but interest as pledge mode", () => {
    expect(campaignMode("interest")).toBe("interest");
    expect(campaignMode(undefined)).toBe("pledge");
    expect(campaignMode("tickets")).toBe("pledge");
  });

  it("confirms in plain words and never says pledge or back", () => {
    const withCity = interestConfirmation({ city: "Lyon", notifyWhenOpen: true, createdAt: "" });
    expect(withCity).toBe("You said you would come in Lyon. We will tell you when tickets or pledges open.");
    const plain = interestConfirmation({ city: null, notifyWhenOpen: false, createdAt: "" });
    expect(plain).toBe("You said you would come.");
    expect(plain).not.toMatch(/\b(pledge|back)\b/i);
    expect(interestConfirmation(null)).toBeNull();
  });

  it("summarises the count for the artist", () => {
    expect(interestSummaryLine({ total: 0, notifyCount: 0 })).toContain("Nobody");
    expect(interestSummaryLine({ total: 1, notifyCount: 1 })).toBe("1 person says they would come; 1 asked to be told when it opens.");
    expect(interestSummaryLine({ total: 12, notifyCount: 4 })).toContain("12 people");
  });

  it("explains errors plainly", () => {
    expect(showInterestErrorMessage(new ApiRequestError("x", 401, null))).toContain("Sign in");
    expect(showInterestErrorMessage(new ApiRequestError("Pledges are not available yet", 409, null))).toBe("Pledges are not available yet");
    expect(showInterestErrorMessage(new Error("boom"))).toContain("try again");
  });
});
