import { describe, expect, it } from "vitest";
import {
  formatPasskeyAuthError,
  isRetryablePasskeyRegistrationError,
} from "./AuthProvider";

describe("AuthProvider passkey errors", () => {
  it("treats WebAuthn NotAllowed registration failures as retryable", () => {
    const error = new DOMException(
      "The operation either timed out or was not allowed.",
      "NotAllowedError",
    );

    expect(isRetryablePasskeyRegistrationError(error)).toBe(true);
  });

  it("formats blocked passkey prompts as actionable auth copy", () => {
    const message = formatPasskeyAuthError(
      new Error("NotAllowedError: The operation either timed out or was not allowed."),
    );

    expect(message).toContain("Passkey access was blocked or timed out.");
    expect(message).toContain("use Log In");
  });

  it("keeps unrelated auth errors intact", () => {
    expect(formatPasskeyAuthError(new Error("Calculated Smart Account address is zero."))).toBe(
      "Calculated Smart Account address is zero.",
    );
  });
});
