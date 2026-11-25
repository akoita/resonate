import { describe, expect, it } from "vitest";
import {
  PARTICIPATION_CHOICES,
  changedChoices,
  choiceIsOn,
  describeChange,
  withChoice,
} from "./participationChoices";

const SAFE = {
  remixConsent: "allowed",
  aiRemixApproval: "required",
  aiSourceUse: "disabled",
  stemListing: "disabled",
} as const;

describe("participation choices", () => {
  it("lists the AI choices last", () => {
    const order = PARTICIPATION_CHOICES.map((c) => c.setting);
    expect(order.slice(-2).sort()).toEqual(["aiRemixApproval", "aiSourceUse"]);
  });

  it("reads and flips a choice", () => {
    expect(choiceIsOn(SAFE, "aiRemixApproval")).toBe(true);
    expect(choiceIsOn(SAFE, "stemListing")).toBe(false);
    const next = withChoice(SAFE, "stemListing", true);
    expect(next.stemListing).toBe("allowed");
    expect(withChoice(next, "aiRemixApproval", false).aiRemixApproval).toBe("not_required");
  });

  it("sends only what changed", () => {
    expect(changedChoices(SAFE, SAFE)).toEqual({});
    expect(changedChoices(SAFE, withChoice(SAFE, "aiSourceUse", true))).toEqual({ aiSourceUse: "allowed" });
  });

  it("describes a history line in plain words", () => {
    expect(describeChange({ setting: "stemListing", previousValue: "disabled", value: "allowed" }))
      .toBe("Offer my stems as collectibles: off → on");
    expect(describeChange({ setting: "remixConsent", previousValue: null, value: "allowed" }))
      .toContain("not set → on");
  });
});
