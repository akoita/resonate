/**
 * #2169: the email-notice API helpers and the words around them. `fetch` is
 * stubbed the way `api.test.ts` stubs it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  API_BASE,
  ApiRequestError,
  confirmContactEmail,
  getContactEmail,
  removeContactEmail,
  resendContactEmailConfirmation,
  setContactEmail,
  setContactEmailPreferences,
  unsubscribeEmail,
  type ContactEmailState,
} from "./api";
import {
  CONTACT_EMAIL_ERROR_MESSAGES,
  GENERIC_CONTACT_EMAIL_ERROR,
  describeContactEmailError,
  optOutsAfterToggle,
  requiredReason,
  tokenFromSearchParams,
  validateContactEmailInput,
} from "./contactEmail";

const mockFetch = vi.fn();

const STATE: ContactEmailState = {
  available: true,
  address: "a@example.com",
  status: "confirmed",
  disabledReason: null,
  confirmationSentAt: null,
  categories: [
    { category: "policy", required: false, enabled: true },
    { category: "terms", required: true, enabled: true },
    { category: "incident", required: false, enabled: false },
    { category: "moderation", required: false, enabled: true },
    { category: "account", required: true, enabled: true },
    { category: "refund", required: false, enabled: true },
  ],
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function lastCall() {
  const [url, init] = mockFetch.mock.calls.at(-1) as [string, RequestInit];
  return { url, init, headers: new Headers(init.headers), body: init.body ? JSON.parse(String(init.body)) : undefined };
}

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("contact email API helpers", () => {
  it("reads the state with the bearer token", async () => {
    mockFetch.mockResolvedValue(json(STATE));
    await expect(getContactEmail("jwt")).resolves.toEqual(STATE);
    const call = lastCall();
    expect(call.url).toBe(`${API_BASE}/me/contact-email`);
    expect(call.init.method).toBeUndefined();
    expect(call.headers.get("Authorization")).toBe("Bearer jwt");
  });

  it("sets the address with PUT and the address in the body", async () => {
    mockFetch.mockResolvedValue(json({ ...STATE, status: "pending" }));
    const state = await setContactEmail("jwt", "new@example.com");
    expect(state.status).toBe("pending");
    const call = lastCall();
    expect(call.url).toBe(`${API_BASE}/me/contact-email`);
    expect(call.init.method).toBe("PUT");
    expect(call.body).toEqual({ address: "new@example.com" });
    expect(call.headers.get("Authorization")).toBe("Bearer jwt");
  });

  it("resends the confirmation with POST", async () => {
    mockFetch.mockResolvedValue(json({ ...STATE, status: "pending" }));
    await resendContactEmailConfirmation("jwt");
    const call = lastCall();
    expect(call.url).toBe(`${API_BASE}/me/contact-email/resend`);
    expect(call.init.method).toBe("POST");
    expect(call.headers.get("Authorization")).toBe("Bearer jwt");
  });

  it("removes the address with DELETE and accepts 204", async () => {
    mockFetch.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(removeContactEmail("jwt")).resolves.toBeNull();
    const call = lastCall();
    expect(call.url).toBe(`${API_BASE}/me/contact-email`);
    expect(call.init.method).toBe("DELETE");
  });

  it("sends the opt-outs to the preferences route", async () => {
    mockFetch.mockResolvedValue(json(STATE));
    await setContactEmailPreferences("jwt", ["incident", "refund"]);
    const call = lastCall();
    expect(call.url).toBe(`${API_BASE}/me/contact-email/preferences`);
    expect(call.init.method).toBe("PUT");
    expect(call.body).toEqual({ optOuts: ["incident", "refund"] });
  });

  it("confirms with the token in the body and no Authorization header", async () => {
    mockFetch.mockResolvedValue(json({ status: "confirmed" }));
    await expect(confirmContactEmail("raw-token")).resolves.toEqual({ status: "confirmed" });
    const call = lastCall();
    expect(call.url).toBe(`${API_BASE}/email/confirm`);
    expect(call.init.method).toBe("POST");
    expect(call.body).toEqual({ token: "raw-token" });
    expect(call.headers.has("Authorization")).toBe(false);
  });

  it("unsubscribes with the token in the body and no Authorization header", async () => {
    mockFetch.mockResolvedValue(json({ category: "incident", status: "unsubscribed" }));
    await expect(unsubscribeEmail("raw-token")).resolves.toEqual({ category: "incident", status: "unsubscribed" });
    const call = lastCall();
    expect(call.url).toBe(`${API_BASE}/email/unsubscribe`);
    expect(call.init.method).toBe("POST");
    expect(call.body).toEqual({ token: "raw-token" });
    expect(call.headers.has("Authorization")).toBe(false);
  });
});

describe("error codes become friendly messages", () => {
  async function failure(call: () => Promise<unknown>) {
    return call().then(
      () => {
        throw new Error("expected a rejection");
      },
      (error: unknown) => error,
    );
  }

  it("email_unavailable (503) from setting the address", async () => {
    mockFetch.mockResolvedValue(json({ code: "email_unavailable" }, 503));
    const error = await failure(() => setContactEmail("jwt", "a@example.com"));
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(describeContactEmailError(error)).toBe(CONTACT_EMAIL_ERROR_MESSAGES.email_unavailable);
    expect(describeContactEmailError(error)).not.toMatch(/API 503/);
  });

  it("email_rate_limited (429) says how long to wait", async () => {
    mockFetch.mockResolvedValue(
      json({ code: "email_rate_limited", message: "Too many confirmation emails. Try again later.", retryAfterSeconds: 90 }, 429),
    );
    const error = await failure(() => resendContactEmailConfirmation("jwt"));
    expect(describeContactEmailError(error)).toBe(
      "You've asked for several confirmation emails. Please try again in 2 minutes.",
    );
  });

  it("email_send_failed (502) points at Resend", async () => {
    mockFetch.mockResolvedValue(json({ code: "email_send_failed" }, 502));
    const error = await failure(() => setContactEmail("jwt", "a@example.com"));
    expect(describeContactEmailError(error)).toBe(CONTACT_EMAIL_ERROR_MESSAGES.email_send_failed);
    expect(describeContactEmailError(error)).toMatch(/Resend/);
  });

  it("invalid_or_expired (400) from confirming, without logging the token to the console", async () => {
    mockFetch.mockResolvedValue(json({ code: "invalid_or_expired" }, 400));
    const error = await failure(() => confirmContactEmail("old"));
    expect(describeContactEmailError(error)).toBe(CONTACT_EMAIL_ERROR_MESSAGES.invalid_or_expired);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("invalid (400) from unsubscribing", async () => {
    mockFetch.mockResolvedValue(json({ code: "invalid" }, 400));
    const error = await failure(() => unsubscribeEmail("bad"));
    expect(describeContactEmailError(error)).toBe(CONTACT_EMAIL_ERROR_MESSAGES.invalid);
  });

  it("a rate limit keeps the client's friendly wording", async () => {
    mockFetch.mockResolvedValue(new Response("Too Many Requests", { status: 429 }));
    const error = await failure(() => setContactEmail("jwt", "a@example.com"));
    expect(describeContactEmailError(error)).toMatch(/a bit too quickly/);
  });

  it("a stale resend (409) says what happened", async () => {
    mockFetch.mockResolvedValue(json({ message: "Conflict" }, 409));
    const error = await failure(() => resendContactEmailConfirmation("jwt"));
    expect(describeContactEmailError(error)).toMatch(/no longer waiting for confirmation/);
  });

  it("anything else is a plain retry prompt, never an API status line", async () => {
    mockFetch.mockResolvedValue(json({ message: "boom" }, 500));
    const error = await failure(() => getContactEmail("jwt"));
    expect(describeContactEmailError(error)).toBe(GENERIC_CONTACT_EMAIL_ERROR);
    expect(describeContactEmailError(new TypeError("fetch failed"))).toBe(GENERIC_CONTACT_EMAIL_ERROR);
  });
});

describe("small rules", () => {
  it("validates what was typed", () => {
    expect(validateContactEmailInput("   ")).toMatch(/Enter your email/);
    expect(validateContactEmailInput("nope")).toMatch(/does not look like/);
    expect(validateContactEmailInput("a@b")).toMatch(/does not look like/);
    expect(validateContactEmailInput(`${"a".repeat(250)}@example.com`)).toMatch(/too long/);
    expect(validateContactEmailInput("  me@example.com ")).toBeNull();
  });

  it("builds the opt-out list from a toggle, never including required categories", () => {
    expect(optOutsAfterToggle(STATE.categories, "refund", false)).toEqual(["incident", "refund"]);
    expect(optOutsAfterToggle(STATE.categories, "incident", true)).toEqual([]);
    expect(optOutsAfterToggle(STATE.categories, "policy", true)).toEqual(["incident"]);
    for (const list of [optOutsAfterToggle(STATE.categories, "terms", false)]) {
      expect(list).not.toContain("terms");
      expect(list).not.toContain("account");
    }
  });

  it("gives every required category a reason", () => {
    expect(requiredReason("terms")).toMatch(/^Required:/);
    expect(requiredReason("account")).toMatch(/^Required:/);
  });

  it("reads a single token from the query", () => {
    expect(tokenFromSearchParams({ token: " abc " })).toBe("abc");
    expect(tokenFromSearchParams({})).toBeNull();
    expect(tokenFromSearchParams({ token: "" })).toBeNull();
    expect(tokenFromSearchParams({ token: ["a", "b"] })).toBeNull();
  });
});
