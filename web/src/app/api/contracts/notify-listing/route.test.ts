import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

function request(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost:3001/api/contracts/notify-listing", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("POST /api/contracts/notify-listing proxy", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("forwards the Authorization header and the multi-tier body unchanged", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const body = {
      tokenId: "74",
      sellerAddress: "0xSeller",
      tiers: [
        { licenseType: "personal", pricePerUnit: "1", amount: "1", ordinal: 0, listingId: "40" },
        { licenseType: "remix", pricePerUnit: "5", amount: "1", ordinal: 1 },
      ],
    };

    const res = await POST(request(body, { Authorization: "Bearer jwt-1" }));

    expect(res.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/metadata\/notify-listing$/);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer jwt-1");
    expect(JSON.parse(init.body as string)).toEqual(body);
  });

  it("passes a backend 401 through to the caller", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Unauthorized", { status: 401 })));

    const res = await POST(request({ tokenId: "74" }));

    expect(res.status).toBe(401);
  });
});
