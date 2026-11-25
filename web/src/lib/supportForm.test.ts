import { describe, expect, it } from "vitest";
import { ApiRequestError } from "./api";
import {
  EMPTY_SUPPORT_FORM,
  SUPPORT_MESSAGE_MAX,
  SUPPORT_TOPICS,
  supportErrorMessage,
  supportTopicLabel,
  validateSupportForm,
} from "./supportForm";

describe("support form (#2667)", () => {
  it("offers the topics the server accepts", () => {
    expect(SUPPORT_TOPICS.map((t) => t.value).sort()).toEqual(
      ["account", "listening", "other", "payments", "rights", "uploads"],
    );
    expect(supportTopicLabel("payments")).toBe("Payments, purchases or refunds");
    expect(supportTopicLabel("unknown")).toBe("unknown");
  });

  it("asks for a topic and a message of a sensible length", () => {
    expect(validateSupportForm(EMPTY_SUPPORT_FORM)).toEqual({
      topic: expect.any(String),
      message: expect.any(String),
    });
    expect(validateSupportForm({ ...EMPTY_SUPPORT_FORM, topic: "other", message: "x".repeat(SUPPORT_MESSAGE_MAX + 1) }).message)
      .toContain("under");
    expect(validateSupportForm({ ...EMPTY_SUPPORT_FORM, topic: "other", message: "I need some help please." })).toEqual({});
  });

  it("accepts an empty email but not a malformed one", () => {
    const base = { ...EMPTY_SUPPORT_FORM, topic: "account" as const, message: "I cannot sign in at all." };
    expect(validateSupportForm(base).email).toBeUndefined();
    expect(validateSupportForm({ ...base, email: "not-an-address" }).email).toBeDefined();
    expect(validateSupportForm({ ...base, email: "me@example.com" }).email).toBeUndefined();
  });

  it("explains the rate limit in plain words", () => {
    expect(supportErrorMessage(new ApiRequestError("x", 429, undefined))).toContain("several messages");
    expect(supportErrorMessage(new ApiRequestError("x", 400, undefined))).toContain("Check each field");
    expect(supportErrorMessage(new Error("network"))).toContain("try again");
  });
});
