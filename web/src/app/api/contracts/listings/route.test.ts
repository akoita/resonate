import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("listings proxy (#2379)", () => {
  it("forwards the source filter of Browse stems to the backend", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ listings: [], total: 0 }), { status: 200 }));
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    const response = await GET(
      new NextRequest("http://localhost:3001/api/contracts/listings?status=active&limit=24&offset=0&sortBy=newest&source=official"),
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const forwarded = new URL(String(fetchMock.mock.calls[0][0]));
    expect(forwarded.pathname).toBe("/metadata/listings");
    expect(forwarded.searchParams.get("source")).toBe("official");
    expect(forwarded.searchParams.get("status")).toBe("active");
  });
});
