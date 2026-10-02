/** Crate watch API helper (#1967): only the watch is sent, errors keep their code. */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const api = await import("./api");
const { crateErrorCode, crateErrorMessage } = await import("./crates");

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    headers: new Headers({ "Content-Type": "application/json" }),
    text: async () => JSON.stringify(body),
  };
}

describe("setCrateWatch", () => {
  beforeEach(() => mockFetch.mockReset());

  it("patches only the watch", async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { crate: { id: "c1" } }));
    await api.setCrateWatch("jwt", "c 1", { mode: "notify", expiresInDays: 30 });
    const [url, init] = mockFetch.mock.calls[0];
    expect(new URL(String(url)).pathname).toBe("/crates/c%201");
    expect((init as RequestInit).method).toBe("PATCH");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      watch: { mode: "notify", expiresInDays: 30 },
    });
    expect(new Headers((init as RequestInit).headers).get("Authorization")).toBe("Bearer jwt");
  });

  it("keeps the backend code of a 409 and a 403 and words them plainly", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mockFetch.mockResolvedValueOnce(jsonResponse(409, { code: "crate_not_saved", message: "x" }));
    const draft = await api.setCrateWatch("jwt", "c1", { mode: "notify" }).catch((e) => e);
    expect(crateErrorCode(draft)).toBe("crate_not_saved");
    expect(crateErrorMessage(draft, "fallback")).toBe("Save the crate to watch it.");

    mockFetch.mockResolvedValueOnce(jsonResponse(403, { code: "pro_required" }));
    const pro = await api.setCrateWatch("jwt", "c1", { mode: "notify" }).catch((e) => e);
    expect(crateErrorMessage(pro, "fallback")).toBe("This needs Crate Digger Pro.");
  });
});
