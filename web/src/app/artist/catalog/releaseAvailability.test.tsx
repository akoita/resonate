/**
 * #1793 — an artist withdrawing a release and putting it back.
 *
 * The suite runs in a `node` environment with no DOM (see
 * `vitest.config.ts`), so the requests are asserted through the handlers with
 * `fetch` stubbed, and the markup through static rendering — the pattern used
 * by `src/components/settings/DataExportPanel.test.tsx`.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ReleaseAvailabilityActions,
  ReleaseWithdrawnMarker,
  createReleaseAvailabilityHandlers,
  isWithdrawnRelease,
  withdrawConfirmMessage,
  withdrawConfirmTitle,
} from "./releaseAvailability";
import { API_BASE, type Release } from "../../../lib/api";

type Toast = { type: string; title: string; message: string };

const mockFetch = vi.fn();

function release(overrides: Partial<Release> = {}): Release {
  return {
    id: "rel-1",
    artistId: "art-1",
    title: "Blue Hour",
    status: "published",
    type: "EP",
    explicit: false,
    createdAt: "2026-09-01T10:00:00.000Z",
    ...overrides,
  };
}

const withdrawn = release({
  status: "withdrawn",
  withdrawnAt: "2026-09-16T10:00:00.000Z",
  withdrawalReason: "Re-clearing a sample",
});

function okResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => JSON.stringify(body),
  };
}

function harness(token: string | null = "jwt-token") {
  const toasts: Toast[] = [];
  const updated: Release[] = [];
  const pending: (Release | null)[] = [];
  const busy: (string | null)[] = [];

  const handlers = createReleaseAvailabilityHandlers({
    token,
    addToast: (toast) => toasts.push(toast),
    onUpdated: (r) => updated.push(r),
    setPending: (r) => pending.push(r),
    setBusyReleaseId: (id) => busy.push(id),
  });

  return { handlers, toasts, updated, pending, busy };
}

describe("withdraw and restore requests (#1793)", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks to open the confirmation without touching the server", () => {
    const { handlers, pending } = harness();

    handlers.requestWithdraw(release());

    expect(pending).toEqual([release()]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("changes nothing when the artist dismisses the confirmation", () => {
    const { handlers, pending, updated } = harness();

    handlers.requestWithdraw(release());
    handlers.cancelWithdraw();

    // The dialog closed, the catalog is untouched, and no request was made.
    expect(pending[pending.length - 1]).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(updated).toHaveLength(0);
  });

  it("withdraws through the owner-scoped route with the artist's token", async () => {
    mockFetch.mockResolvedValueOnce(okResponse(withdrawn));
    const { handlers, updated, toasts, pending } = harness();

    await handlers.confirmWithdraw(release());

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe(`${API_BASE}/catalog/me/releases/rel-1/withdraw`);
    const init = mockFetch.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect((init.headers as Headers).get("Authorization")).toBe("Bearer jwt-token");
    expect(updated[0].status).toBe("withdrawn");
    expect(pending[pending.length - 1]).toBeNull();
    expect(toasts[0].type).toBe("success");
  });

  it("sends the artist's note when they gave one, and nothing when they did not", async () => {
    mockFetch.mockResolvedValue(okResponse(withdrawn));
    const { handlers } = harness();

    await handlers.confirmWithdraw(release(), "  Re-clearing a sample  ");
    expect(JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      reason: "Re-clearing a sample",
    });

    await handlers.confirmWithdraw(release());
    expect(JSON.parse((mockFetch.mock.calls[1][1] as RequestInit).body as string)).toEqual({});
  });

  it("restores through the restore route, in one step", async () => {
    mockFetch.mockResolvedValueOnce(okResponse(release({ status: "published" })));
    const { handlers, updated, toasts } = harness();

    await expect(handlers.restore(withdrawn)).resolves.toBe(true);

    expect(mockFetch.mock.calls[0][0]).toBe(`${API_BASE}/catalog/me/releases/rel-1/restore`);
    expect((mockFetch.mock.calls[0][1] as RequestInit).method).toBe("POST");
    expect(isWithdrawnRelease(updated[0])).toBe(false);
    expect(toasts[0].type).toBe("success");
  });

  it("marks the release busy while the request is in flight, then releases it", async () => {
    mockFetch.mockResolvedValueOnce(okResponse(withdrawn));
    const { handlers, busy } = harness();

    await handlers.confirmWithdraw(release());

    expect(busy).toEqual(["rel-1", null]);
  });

  it("reports a failure without blaming the artist, and leaves the catalog alone", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: async () => "boom",
    });
    const { handlers, toasts, updated, busy } = harness();

    // It answers false rather than throwing: the shared confirm dialog needs
    // that answer to hand the artist their buttons back.
    await expect(handlers.confirmWithdraw(release())).resolves.toBe(false);

    expect(updated).toHaveLength(0);
    expect(toasts[0].type).toBe("error");
    expect(toasts[0].message.toLowerCase()).toContain("on our side");
    expect(toasts[0].message.toLowerCase()).toContain("nothing changed");
    // The control must become usable again.
    expect(busy[busy.length - 1]).toBeNull();
  });

  it("does not call the server at all when nobody is signed in", async () => {
    const { handlers, toasts } = harness(null);

    await expect(handlers.confirmWithdraw(release())).resolves.toBe(false);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(toasts[0].type).toBe("info");
  });
});

describe("what the confirmation tells the artist (#1793)", () => {
  const message = withdrawConfirmMessage(release()).toLowerCase();

  it("names the release it is about", () => {
    expect(withdrawConfirmTitle(release())).toContain("Blue Hour");
  });

  it("says plainly that buyers keep what they bought", () => {
    expect(message).toContain("people who bought it keep it");
  });

  it("says the track stays visible in listeners' libraries, marked unavailable", () => {
    expect(message).toContain("libraries and playlists");
    expect(message).toContain("unavailable");
  });

  it("says it is reversible, rather than leaving the artist to guess", () => {
    expect(message).toContain("restore it whenever you want");
  });

  it("does not pretend a withdrawal deletes anything", () => {
    expect(message).not.toContain("delete");
    expect(message).not.toContain("permanent");
  });
});

describe("how a withdrawn release looks in the catalogue (#1793)", () => {
  it("marks it as withdrawn, with the date and the artist's note", () => {
    const html = renderToStaticMarkup(<ReleaseWithdrawnMarker release={withdrawn} />);

    expect(html).toContain("Withdrawn");
    expect(html).toContain("Sep 16, 2026");
    expect(html).toContain("Re-clearing a sample");
  });

  it("marks nothing on a release that is still streaming", () => {
    expect(renderToStaticMarkup(<ReleaseWithdrawnMarker release={release()} />)).toBe("");
  });

  it("offers withdrawal on a live release and restoration on a withdrawn one", () => {
    const live = renderToStaticMarkup(
      <ReleaseAvailabilityActions
        release={release()}
        busy={false}
        onWithdraw={() => {}}
        onRestore={() => {}}
      />,
    );
    const paused = renderToStaticMarkup(
      <ReleaseAvailabilityActions
        release={withdrawn}
        busy={false}
        onWithdraw={() => {}}
        onRestore={() => {}}
      />,
    );

    expect(live).toContain("Withdraw from streaming");
    expect(live).not.toContain("disabled");
    expect(paused).toContain("Restore to streaming");
    // Restoring is not destructive and must carry no scare copy.
    expect(paused.toLowerCase()).not.toContain("warning");
    expect(paused.toLowerCase()).not.toContain("permanent");
  });

  it("shows progress and disables itself while a request is running", () => {
    const html = renderToStaticMarkup(
      <ReleaseAvailabilityActions
        release={release()}
        busy
        onWithdraw={() => {}}
        onRestore={() => {}}
      />,
    );

    expect(html).toContain("Withdrawing…");
    expect(html).toContain("disabled");
  });
});
