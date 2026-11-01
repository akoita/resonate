import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PublicPlaylistSummary, Release } from "../../lib/api";
import type { CatalogArtistSummary } from "../../lib/catalogDisplay";
import { HomeTile } from "../home/HomeTile";
import { CatalogArtistCard } from "./CatalogArtistCard";
import { CatalogPlaylistCard } from "./CatalogPlaylistCard";
import { CatalogReleaseCard } from "./CatalogReleaseCard";

// The queue button needs the player and toasts; static markup only renders it.
vi.mock("../../lib/useQueueActions", () => ({
  useQueueActions: () => ({ queue: vi.fn(), contextMenuItems: vi.fn(), actionMenuItems: vi.fn() }),
}));
vi.mock("../ui/Toast", () => ({ useToast: () => ({ addToast: vi.fn() }) }));

function makeRelease(overrides: Partial<Release> = {}): Release {
  return {
    id: "rel-1",
    artistId: "manager-1",
    title: "Lovebird",
    status: "ready",
    type: "SINGLE",
    primaryArtist: "Nova",
    genre: "Pop",
    explicit: false,
    createdAt: "2026-09-01T00:00:00.000Z",
    tracks: [
      {
        id: "trk-1",
        releaseId: "rel-1",
        title: "Lovebird",
        position: 1,
        explicit: false,
        createdAt: "2026-09-01T00:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

/** Every <a>…</a> in the markup, which must never wrap the queue button. */
function links(html: string) {
  return html.match(/<a [\s\S]*?<\/a>/g) ?? [];
}

function queueButton(html: string, title: string) {
  const match = html.match(new RegExp(`<button[^>]*aria-label="Queue ${title}"[^>]*>`));
  expect(match).not.toBeNull();
  return match![0];
}

describe("queue from cards", () => {
  it("offers a queue menu button on a queueable release card, outside the title link", () => {
    const html = renderToStaticMarkup(<CatalogReleaseCard release={makeRelease()} queueable />);
    expect(html).toContain("data-card-queue");
    const button = queueButton(html, "Lovebird");
    expect(button).toContain('aria-haspopup="menu"');
    expect(button).not.toContain("disabled");
    expect(links(html).some((link) => link.includes("Queue Lovebird"))).toBe(false);
  });

  it("keeps release cards free of queue controls unless asked", () => {
    const html = renderToStaticMarkup(<CatalogReleaseCard release={makeRelease()} />);
    expect(html).not.toContain("data-card-queue");
    expect(html).not.toContain("Queue Lovebird");
  });

  it("disables the queue button of a release with no tracks", () => {
    const html = renderToStaticMarkup(
      <CatalogReleaseCard release={makeRelease({ tracks: [] })} queueable />,
    );
    expect(queueButton(html, "Lovebird")).toContain("disabled");
  });

  it("lays the artist queue button beside the profile link, not inside it", () => {
    const artist: CatalogArtistSummary = {
      key: "public-nova",
      name: "Nova",
      artistId: "public-nova",
      releaseCount: 1,
      stemCount: 0,
      latestRelease: makeRelease(),
      latestAt: 0,
      genres: new Set(["Pop"]),
      releases: [makeRelease()],
    };
    const html = renderToStaticMarkup(<CatalogArtistCard artist={artist} queueable />);
    expect(html).toContain('class="ng-cat-artist-wrap" data-card-queue=""');
    queueButton(html, "Nova");
    expect(links(html)).toHaveLength(1);
    expect(links(html)[0]).not.toContain("<button");
    // Without `queueable` the card is the bare link, as before.
    expect(renderToStaticMarkup(<CatalogArtistCard artist={artist} />)).not.toContain("ng-cat-artist-wrap");
  });

  it("offers queueing on a public playlist card that has tracks", () => {
    const playlist = {
      id: "pl-1",
      name: "Night Drive",
      ownerUserId: "u-1",
      ownerDisplayName: "Ada",
      trackCount: 3,
      coverArtworkUrls: [],
    } as unknown as PublicPlaylistSummary;
    queueButton(renderToStaticMarkup(<CatalogPlaylistCard playlist={playlist} queueable />), "Night Drive");
    const empty = renderToStaticMarkup(
      <CatalogPlaylistCard playlist={{ ...playlist, trackCount: 0 }} queueable />,
    );
    expect(empty).not.toContain("Queue Night Drive");
  });

  it("adds a queue button to home tiles given a target", () => {
    const html = renderToStaticMarkup(
      <HomeTile
        href="/release/rel-1"
        art={<span />}
        title="When It Hurts"
        queueTarget={{ kind: "track", title: "When It Hurts", releaseId: "rel-1", trackId: "trk-1" }}
      />,
    );
    expect(html).toContain("ng-tile--queueable");
    expect(html).toContain("ng-tile__queue-slot");
    queueButton(html, "When It Hurts");
    expect(links(html).some((link) => link.includes("<button"))).toBe(false);
  });
});
