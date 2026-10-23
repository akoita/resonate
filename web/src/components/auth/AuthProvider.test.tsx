import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import AuthProvider, {
  formatPasskeyAuthError,
  isRetryablePasskeyRegistrationError,
  readStoredSession,
  useAuth,
} from "./AuthProvider";
import { ADDRESS_KEY, SA_ADDRESS_KEY, TOKEN_KEY } from "../../lib/authSession";

vi.mock("./ZeroDevProviderClient", () => ({
  useZeroDev: () => ({ projectId: "", publicClient: {}, chainId: 31337 }),
}));
vi.mock("../ui/Toast", () => ({ useToast: () => ({ addToast: vi.fn() }) }));

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

function storage(entries: Record<string, string>): Pick<Storage, "getItem"> {
  return { getItem: (key) => entries[key] ?? null };
}

describe("AuthProvider sessionChecked (#2254)", () => {
  it("is false until the stored-session restore effect has run", () => {
    // Server rendering never runs effects, so this is the first client render
    // too: the page must not yet treat the visitor as signed out.
    function Probe() {
      const { sessionChecked, status } = useAuth();
      return <span data-checked={String(sessionChecked)} data-status={status} />;
    }
    const html = renderToStaticMarkup(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    expect(html).toContain('data-checked="false"');
    expect(html).toContain('data-status="idle"');
  });

  it("readStoredSession reports a stored session, or null when there is none", () => {
    expect(readStoredSession(storage({}))).toBeNull();
    expect(readStoredSession(storage({ [TOKEN_KEY]: "t" }))).toBeNull();
    expect(
      readStoredSession(storage({ [TOKEN_KEY]: "t", [ADDRESS_KEY]: "0xabc", [SA_ADDRESS_KEY]: "0xdef" })),
    ).toEqual({ token: "t", address: "0xabc", smartAccountAddress: "0xdef" });
    expect(readStoredSession(storage({ [TOKEN_KEY]: "t", [ADDRESS_KEY]: "0xabc" }))).toEqual({
      token: "t",
      address: "0xabc",
      smartAccountAddress: null,
    });
  });
});
