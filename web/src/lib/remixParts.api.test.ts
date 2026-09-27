/**
 * AI parts API helpers (#1901): URLs, methods, bodies and the owner's
 * bearer token on every call.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);
vi.stubGlobal("process", {
  ...process,
  env: { ...process.env, NEXT_PUBLIC_API_URL: "http://test-api:3000" },
});

const api = await import("./api");

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => JSON.stringify(body),
  };
}

describe("AI parts API helpers (#1901)", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("generateRemixParts posts the request with the bearer token", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ batchId: "b", quoteCents: 30, perTakeCents: 10, takes: [] }),
    );
    const result = await api.generateRemixParts("tok", "p1", {
      role: "keys",
      bars: 4,
      style: "warm",
      takes: 3,
    });
    expect(result).toEqual({ batchId: "b", quoteCents: 30, perTakeCents: 10, takes: [] });
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("http://test-api:3000/remix/projects/p1/parts/generate");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ role: "keys", bars: 4, style: "warm", takes: 3 });
    expect((init.headers as Headers).get("Authorization")).toBe("Bearer tok");
  });

  it("deleteRemixPartTake deletes the encoded take id", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: "p1" }));
    await api.deleteRemixPartTake("tok", "p1", "take/1");
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("http://test-api:3000/remix/projects/p1/parts/takes/take%2F1");
    expect(init.method).toBe("DELETE");
    expect((init.headers as Headers).get("Authorization")).toBe("Bearer tok");
  });

  it("fetchRemixPartTakeAudio returns the bytes, owner-authenticated", async () => {
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    mockFetch.mockResolvedValueOnce({ ok: true, arrayBuffer: async () => bytes });
    await expect(api.fetchRemixPartTakeAudio("tok", "p1", "t1")).resolves.toBe(bytes);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("http://test-api:3000/remix/projects/p1/parts/takes/t1/audio");
    expect(init.headers).toEqual({ Authorization: "Bearer tok" });
  });

  it("fetchRemixPartTakeAudio surfaces a failed request", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: async () => JSON.stringify({ code: "take_not_found", message: "This AI part take has no audio." }),
    });
    await expect(api.fetchRemixPartTakeAudio("tok", "p1", "t1")).rejects.toThrow();
  });
});
