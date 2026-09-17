/**
 * #1771 — the Settings door people take their own data out through.
 *
 * The web unit suite runs in a `node` environment with no DOM (see
 * `vitest.config.ts`), so the markup is asserted through static rendering and
 * the download itself is asserted through the exported runner with `fetch`,
 * `window`, `document`, and the object-URL API stubbed the way
 * `src/lib/api.test.ts` stubs them.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DataExportPanel, { DataExportCard, downloadPersonalDataExport } from "./DataExportPanel";
import { API_BASE } from "../../lib/api";

type Toast = { type: string; title: string; message: string };

const mockFetch = vi.fn();

type FakeAnchor = {
  href: string;
  download: string;
  rel: string;
  style: { display: string };
  click: () => void;
  remove: () => void;
};

let anchors: FakeAnchor[] = [];
let revoked: string[] = [];

function stubBrowser() {
  anchors = [];
  revoked = [];
  vi.stubGlobal("fetch", mockFetch);
  vi.stubGlobal("window", {} as Window & typeof globalThis);
  vi.stubGlobal("document", {
    createElement: () => {
      const anchor: FakeAnchor = {
        href: "",
        download: "",
        rel: "",
        style: { display: "" },
        click: vi.fn(),
        remove: vi.fn(),
      };
      anchors.push(anchor);
      return anchor;
    },
    body: { appendChild: vi.fn() },
  } as unknown as Document);
  (URL as typeof URL & { createObjectURL: (blob: Blob) => string }).createObjectURL = vi.fn(
    () => "blob:export",
  );
  (URL as typeof URL & { revokeObjectURL: (url: string) => void }).revokeObjectURL = vi.fn(
    (url: string) => {
      revoked.push(url);
    },
  );
}

function exportResponse(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: {
      get: (key: string) =>
        key === "Content-Disposition"
          ? 'attachment; filename="resonate-data-export-2026-09-17.json"'
          : null,
    },
    blob: async () => new Blob(["{}"], { type: "application/json" }),
    ...overrides,
  };
}

function collectToasts() {
  const toasts: Toast[] = [];
  return { toasts, addToast: (toast: Toast) => toasts.push(toast) };
}

describe("data export download (#1771)", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    stubBrowser();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("asks the server for the export with the signed-in person's token", async () => {
    mockFetch.mockResolvedValueOnce(exportResponse());
    const { toasts, addToast } = collectToasts();

    await downloadPersonalDataExport("jwt-token", addToast);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe(`${API_BASE}/privacy/export`);
    expect((mockFetch.mock.calls[0][1] as RequestInit).headers).toEqual({
      Authorization: "Bearer jwt-token",
    });
    expect(toasts[0].type).toBe("success");
  });

  it("saves the file under the name the server chose and lets go of the blob", async () => {
    vi.useFakeTimers();
    mockFetch.mockResolvedValueOnce(exportResponse());
    const { toasts, addToast } = collectToasts();

    await downloadPersonalDataExport("jwt-token", addToast);
    vi.runAllTimers();

    expect(anchors).toHaveLength(1);
    expect(anchors[0].download).toBe("resonate-data-export-2026-09-17.json");
    expect(anchors[0].click).toHaveBeenCalledTimes(1);
    // The object URL pins the whole export in memory; it must not outlive the
    // click that consumed it.
    expect(revoked).toEqual(["blob:export"]);
    expect(toasts[0].message).toContain("resonate-data-export-2026-09-17.json");
  });

  it("falls back to a date-stamped name when the server did not name the file", async () => {
    mockFetch.mockResolvedValueOnce(
      exportResponse({ headers: { get: () => null } }),
    );
    const { addToast } = collectToasts();

    await downloadPersonalDataExport("jwt-token", addToast);

    expect(anchors[0].download).toMatch(/^resonate-data-export-\d{4}-\d{2}-\d{2}\.json$/);
  });

  it("says they already have a recent copy when rate limited, not that something broke", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      text: async () => "rate limited",
    });
    const { toasts, addToast } = collectToasts();

    await downloadPersonalDataExport("jwt-token", addToast);

    expect(toasts).toHaveLength(1);
    expect(toasts[0].type).not.toBe("error");
    expect(`${toasts[0].title} ${toasts[0].message}`.toLowerCase()).toContain("recently");
    expect(`${toasts[0].title} ${toasts[0].message}`.toLowerCase()).toContain("try again");
    // Nothing was downloaded, so nothing should have been handed to the browser.
    expect(anchors).toHaveLength(0);
  });

  it("reports a failure without blaming the person, and does not throw at the caller", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: async () => "boom",
    });
    const { toasts, addToast } = collectToasts();

    // Resolving rather than throwing is what lets the panel's `finally` clear
    // the in-progress state and leave the control usable again.
    await expect(downloadPersonalDataExport("jwt-token", addToast)).resolves.toBeUndefined();

    expect(toasts).toHaveLength(1);
    expect(toasts[0].type).toBe("error");
    expect(toasts[0].message.toLowerCase()).toContain("on our side");
    expect(toasts[0].message.toLowerCase()).toContain("try again");
  });
});

describe("data export panel (#1771)", () => {
  it("offers exactly one working action to a signed-in person", () => {
    const html = renderToStaticMarkup(
      <DataExportPanel token="jwt-token" addToast={() => {}} />,
    );

    const buttons = html.match(/<button/g) ?? [];
    expect(buttons).toHaveLength(1);
    expect(html).toContain("Download my data");
    expect(html).not.toContain("disabled");
  });

  it("disables the action while the file is being prepared, so a second click cannot ask again", () => {
    const html = renderToStaticMarkup(
      <DataExportCard downloading signedIn onDownload={() => {}} />,
    );

    expect(html).toContain("Preparing your file...");
    expect(html).toContain("disabled");
    expect(html).not.toContain("Download my data");
  });

  it("re-enables the action once the attempt is over", () => {
    const html = renderToStaticMarkup(
      <DataExportCard downloading={false} signedIn onDownload={() => {}} />,
    );

    expect(html).toContain("Download my data");
    expect(html).not.toContain("disabled");
  });

  it("states the limits of the file beside the button, not in a footnote", () => {
    const html = renderToStaticMarkup(
      <DataExportCard downloading={false} signedIn onDownload={() => {}} />,
    );

    expect(html).toContain("what Resonate keeps about you in our own systems");
    expect(html).toContain("IPFS");
    expect(html).toContain("blockchain");
  });

  it("promises nothing about deletion — that is not what this control does", () => {
    const html = renderToStaticMarkup(
      <DataExportCard downloading={false} signedIn onDownload={() => {}} />,
    ).toLowerCase();

    expect(html).not.toContain("delete");
    expect(html).not.toContain("erase");
    expect(html).not.toContain("close your account");
  });
});
