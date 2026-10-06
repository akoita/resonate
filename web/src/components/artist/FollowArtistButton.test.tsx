import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const api = await import("../../lib/api");
const { FollowArtistButtonView, followButtonLabel } = await import("./FollowArtistButton");

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    headers: new Headers({ "Content-Type": "application/json" }),
    text: async () => JSON.stringify(body),
  };
}

describe("FollowArtistButtonView", () => {
  it("offers Follow, then Following, and a connect action when signed out", () => {
    const out = renderToStaticMarkup(<FollowArtistButtonView state="signed_out" following={false} />);
    expect(out).toContain(">Follow<");
    expect(out).toContain("Connect to follow this artist");
    expect(out).not.toContain("aria-pressed");

    const idle = renderToStaticMarkup(<FollowArtistButtonView state="ready" following={false} />);
    expect(idle).toContain(">Follow<");
    expect(idle).toContain('aria-pressed="false"');

    const following = renderToStaticMarkup(<FollowArtistButtonView state="ready" following />);
    expect(following).toContain(">Following<");
    expect(following).toContain('aria-pressed="true"');
  });

  it("disables the button while the state loads or a change is pending, and shows a rollback error", () => {
    expect(renderToStaticMarkup(<FollowArtistButtonView state="loading" following={false} />)).toContain("disabled");
    expect(renderToStaticMarkup(<FollowArtistButtonView state="ready" following pending />)).toContain("disabled");
    const failed = renderToStaticMarkup(
      <FollowArtistButtonView state="ready" following={false} error="Could not follow. Try again." />,
    );
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("Could not follow. Try again.");
    expect(followButtonLabel("ready", true, true)).toBe("Following…");
  });
});

describe("artist follow API client", () => {
  beforeEach(() => mockFetch.mockReset());

  it("reads the status with the bearer token", async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { following: true }));
    await expect(api.getArtistFollowStatus("artist 1", "jwt")).resolves.toEqual({ following: true });
    const [url, init] = mockFetch.mock.calls[0];
    expect(new URL(String(url)).pathname).toBe("/artists/artist%201/follow");
    expect((init as RequestInit).method ?? "GET").toBe("GET");
    expect(new Headers((init as RequestInit).headers).get("Authorization")).toBe("Bearer jwt");
  });

  it("follows with only the release context and surface label", async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { following: true }));
    await api.followArtist("artist-1", "jwt", { releaseId: "release-1", source: "release_page" });
    const [url, init] = mockFetch.mock.calls[0];
    expect(new URL(String(url)).pathname).toBe("/artists/artist-1/follow");
    expect((init as RequestInit).method).toBe("PUT");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      releaseId: "release-1",
      source: "release_page",
    });
  });

  it("unfollows with DELETE", async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { following: false }));
    await expect(api.unfollowArtist("artist-1", "jwt")).resolves.toEqual({ following: false });
    const [, init] = mockFetch.mock.calls[0];
    expect((init as RequestInit).method).toBe("DELETE");
  });
});
