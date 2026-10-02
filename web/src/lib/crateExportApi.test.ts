/**
 * Crate export API helpers (#1965): the manifest request, the export download
 * that never logs the folder, the licensed stem download and error reading.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const api = await import("./api");
const { crateErrorCode } = await import("./crates");

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    headers: new Headers({ "Content-Type": "application/json" }),
    text: async () => JSON.stringify(body),
  };
}

describe("crate export API helpers", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("reads the manifest of a crate", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const manifest = { entries: [], skipped: [], notes: [] };
    mockFetch.mockResolvedValue(jsonResponse(200, manifest));
    await expect(api.getCrateExportManifest("jwt", "crate 1")).resolves.toEqual(manifest);
    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toMatch(/\/crates\/crate%201\/export\/manifest$/);
    expect(new Headers((init as RequestInit).headers).get("Authorization")).toBe("Bearer jwt");
    log.mockRestore();
  });

  it("posts the format and folder in the body, never in the URL, and reads the file name header", async () => {
    const blob = new Blob(["<xml/>"]);
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "",
      blob: async () => blob,
      headers: new Headers({ "Content-Disposition": 'attachment; filename="Crate.xml"' }),
    });
    const result = await api.downloadCrateExport("jwt", "c1", "rekordbox", "C:\\Users\\you\\My Music");
    expect(result.blob).toBe(blob);
    expect(result.contentDisposition).toBe('attachment; filename="Crate.xml"');
    const [url, init] = mockFetch.mock.calls[0];
    const parsed = new URL(String(url));
    expect(parsed.pathname).toBe("/crates/c1/export");
    expect(parsed.search).toBe("");
    expect(String(url)).not.toContain("Users");
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      format: "rekordbox",
      folder: "C:\\Users\\you\\My Music",
    });
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get("Authorization")).toBe("Bearer jwt");
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("never logs the folder, on success or on failure", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => undefined),
    );
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "",
      blob: async () => new Blob(["x"]),
      headers: new Headers(),
    });
    await api.downloadCrateExport("jwt", "c1", "serato", "/Users/secret-person/Music");
    mockFetch.mockResolvedValueOnce(jsonResponse(400, { code: "invalid_folder", message: "bad" }));
    await expect(api.downloadCrateExport("jwt", "c1", "serato", "nope")).rejects.toBeInstanceOf(Error);

    const logged = JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
    expect(logged).not.toContain("secret-person");
    expect(logged).not.toContain("nope");
    spies.forEach((spy) => spy.mockRestore());
  });

  it("carries the backend's code and status on a failed export", async () => {
    mockFetch.mockResolvedValue(jsonResponse(409, { code: "nothing_to_export", message: "No stem" }));
    const error = await api.downloadCrateExport("jwt", "c1", "rekordbox", "/Music").catch((e) => e);
    expect(error).toBeInstanceOf(api.ApiRequestError);
    expect(error.status).toBe(409);
    expect(crateErrorCode(error)).toBe("nothing_to_export");
  });

  it("downloads an owned stem through the licensed download path", async () => {
    const blob = new Blob(["mp3"]);
    mockFetch.mockResolvedValue({ ok: true, status: 200, blob: async () => blob, text: async () => "" });
    await expect(api.downloadOwnedStem("jwt", "stem-1", "0xabc")).resolves.toBe(blob);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("/api/encryption/download");
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ stemId: "stem-1", walletAddress: "0xabc" });
    expect(new Headers((init as RequestInit).headers).get("Authorization")).toBe("Bearer jwt");
  });

  it("reports a refused stem download in the server's words, and a rate limit plainly", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403, text: async () => "You do not own this stem." });
    await expect(api.downloadOwnedStem("jwt", "s", "0x1")).rejects.toThrow("You do not own this stem.");
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429, text: async () => "Too Many Requests" });
    await expect(api.downloadOwnedStem("jwt", "s", "0x1")).rejects.toThrow(/a bit too quickly/);
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, text: async () => "" });
    await expect(api.downloadOwnedStem("jwt", "s", "0x1")).rejects.toThrow("Download failed");
  });
});
