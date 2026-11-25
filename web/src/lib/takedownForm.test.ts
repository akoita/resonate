import { describe, expect, it } from "vitest";
import { ApiRequestError } from "./api";
import {
  EMPTY_TAKEDOWN_FORM,
  parseResonateContentLink,
  shortReference,
  takedownErrorMessage,
  toTakedownNotice,
  validateTakedownForm,
  type TakedownFormValues,
} from "./takedownForm";

const filled: TakedownFormValues = {
  ...EMPTY_TAKEDOWN_FORM,
  trackId: "track-1",
  claimantName: "  Rights Holder ",
  claimantCapacity: "rights_holder",
  claimantEmail: " holder@example.com ",
  originalWorkUrl: "My song (2024)",
  contentLocation: "/release/rel-1",
  category: "copyright",
  reason: "Uploaded without permission.",
  goodFaith: true,
};

describe("takedown report form (#2664)", () => {
  it("lists every missing field in plain words", () => {
    const errors = validateTakedownForm(EMPTY_TAKEDOWN_FORM);
    expect(Object.keys(errors).sort()).toEqual(
      ["category", "claimantCapacity", "claimantEmail", "claimantName", "goodFaith", "originalWorkUrl", "reason", "trackId"].sort(),
    );
    expect(errors.goodFaith).toBe("Confirm the statement to send the notice.");
  });

  it("accepts a complete form and trims what it sends", () => {
    expect(validateTakedownForm(filled)).toEqual({});
    expect(toTakedownNotice(filled)).toEqual({
      trackId: "track-1",
      claimantName: "Rights Holder",
      claimantCapacity: "rights_holder",
      claimantEmail: "holder@example.com",
      originalWorkUrl: "My song (2024)",
      contentLocation: "/release/rel-1",
      category: "copyright",
      reason: "Uploaded without permission.",
      goodFaith: true,
      website: "",
    });
  });

  it("refuses an email that is not an address and an overlong explanation", () => {
    const errors = validateTakedownForm({ ...filled, claimantEmail: "nope", reason: "x".repeat(5001) });
    expect(errors.claimantEmail).toBeDefined();
    expect(errors.reason).toContain("5000");
  });

  it("reads release links, with or without a track", () => {
    expect(parseResonateContentLink("https://app.example/release/abc?track=t-9")).toEqual({ releaseId: "abc", trackId: "t-9" });
    expect(parseResonateContentLink("/release/abc")).toEqual({ releaseId: "abc" });
    expect(parseResonateContentLink("https://example.com/somewhere")).toBeNull();
    expect(parseResonateContentLink("")).toBeNull();
  });

  it("explains the rate limit instead of a generic error", () => {
    expect(takedownErrorMessage(new ApiRequestError("x", 429, undefined))).toContain("last hour");
    expect(takedownErrorMessage(new ApiRequestError("x", 404, undefined))).toContain("could not be found");
    expect(takedownErrorMessage(new Error("boom"))).toContain("could not be sent");
  });

  it("shortens a reference to its first block", () => {
    expect(shortReference("3f2a9c1e-1111-2222-3333-444455556666")).toBe("3F2A9C1E");
  });
});
