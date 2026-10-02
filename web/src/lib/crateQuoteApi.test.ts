/**
 * Crate quote API helpers (#1964): the request shapes, the 200 / 202 reading of
 * settle, and how the backend's error codes become plain messages.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const api = await import("./api");
const { crateQuoteErrorMessage, isRetryableSettleError, RATE_LIMIT_TEXT, WALLET_CHANGED_TEXT } =
  await import("./crateQuote");
const { makeQuote, BUYER } = await import("./__tests__/crateQuoteFixtures");

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    headers: new Headers({ "Content-Type": "application/json" }),
    text: async () => JSON.stringify(body),
  };
}

function lastCall() {
  const [url, init] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
  return { url: String(url), init: init as RequestInit, body: init?.body ? JSON.parse(String(init.body)) : undefined };
}

describe("crate quote API helpers", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("creates a quote with the buyer address and optional line overrides", async () => {
    mockFetch.mockResolvedValue(jsonResponse(201, makeQuote()));
    const quote = await api.createCrateQuote("jwt", "crate 1", {
      buyerAddress: BUYER,
      lines: [{ trackId: "t1", licenseType: "remix", stemTypes: ["drums"] }],
    });
    expect(quote.id).toBe("quote-1");
    const call = lastCall();
    expect(call.url).toMatch(/\/crates\/crate%201\/quote$/);
    expect(call.init.method).toBe("POST");
    expect(call.body).toEqual({
      buyerAddress: BUYER,
      lines: [{ trackId: "t1", licenseType: "remix", stemTypes: ["drums"] }],
    });
    expect(new Headers(call.init.headers).get("Authorization")).toBe("Bearer jwt");
  });

  it("reads a quote", async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, makeQuote()));
    await api.getCrateQuote("jwt", "c1", "q 1");
    expect(lastCall().url).toMatch(/\/crates\/c1\/quotes\/q%201$/);
  });

  it("settle sends the hash and dropped lines and reads 202 from a submitted quote", async () => {
    const hash = `0x${"ab".repeat(32)}`;
    mockFetch.mockResolvedValueOnce(jsonResponse(202, makeQuote({ status: "submitted", transactionHash: hash })));
    const pending = await api.settleCrateQuote("jwt", "c1", "q1", {
      transactionHash: hash,
      dropped: [{ quoteLineId: "q2", reason: "listing_changed" }],
    });
    expect(pending.status).toBe(202);
    expect(pending.quote.status).toBe("submitted");
    expect(lastCall().url).toMatch(/\/crates\/c1\/quotes\/q1\/settle$/);
    expect(lastCall().body).toEqual({
      transactionHash: hash,
      dropped: [{ quoteLineId: "q2", reason: "listing_changed" }],
    });

    for (const status of ["settled", "partial", "failed"] as const) {
      mockFetch.mockResolvedValueOnce(jsonResponse(200, makeQuote({ status, transactionHash: hash })));
      const final = await api.settleCrateQuote("jwt", "c1", "q1", { transactionHash: hash });
      expect(final.status).toBe(200);
      expect(final.quote.status).toBe(status);
    }
  });

  it("carries the backend's error code through to a plain message", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(409, { code: "wallet_mismatch", message: "Your signed-in wallet does not match" }),
    );
    const error = await api.createCrateQuote("jwt", "c1", { buyerAddress: BUYER }).catch((e) => e);
    expect(error.status).toBe(409);
    expect(crateQuoteErrorMessage(error, "fallback")).toBe(WALLET_CHANGED_TEXT);
    expect(isRetryableSettleError(error)).toBe(false);
  });
});

describe("crateQuoteErrorMessage", () => {
  const withCode = (status: number, code: string) => ({ status, details: { code, message: "raw" } });

  it("maps every quote and settle error code to a plain message", () => {
    expect(crateQuoteErrorMessage(withCode(409, "no_wallet"), "x")).toMatch(/wallet/i);
    expect(crateQuoteErrorMessage(withCode(409, "wallet_mismatch"), "x")).toBe(
      "Your wallet changed. Sign in again, then get a new quote.",
    );
    expect(crateQuoteErrorMessage(withCode(503, "marketplace_unavailable"), "x")).toMatch(/not available/i);
    expect(crateQuoteErrorMessage(withCode(409, "transaction_already_used"), "x")).toMatch(/already used/i);
    expect(crateQuoteErrorMessage(withCode(409, "already_submitted"), "x")).toMatch(/Get a new quote/);
    expect(crateQuoteErrorMessage(withCode(400, "invalid_lines"), "x")).toMatch(/Get a new quote/);
  });

  it("explains a rate limit and falls back for anything else", () => {
    expect(crateQuoteErrorMessage({ status: 429 }, "x")).toBe(RATE_LIMIT_TEXT);
    expect(crateQuoteErrorMessage({ status: 500 }, "Could not get a quote")).toBe("Could not get a quote");
    expect(crateQuoteErrorMessage(new Error("boom"), "Could not get a quote")).toBe("Could not get a quote");
  });
});

describe("isRetryableSettleError", () => {
  it("retries what can get better and stops on what cannot", () => {
    expect(isRetryableSettleError(new Error("network down"))).toBe(true);
    expect(isRetryableSettleError({ status: 503 })).toBe(true);
    expect(isRetryableSettleError({ status: 502 })).toBe(true);
    expect(isRetryableSettleError({ status: 429 })).toBe(true);
    expect(isRetryableSettleError({ status: 409 })).toBe(false);
    expect(isRetryableSettleError({ status: 400 })).toBe(false);
    expect(isRetryableSettleError({ status: 404 })).toBe(false);
  });
});
