import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Release } from "../../lib/api";
import {
  groupCatalogStemsByTrack,
  type CatalogArtistSummary,
  type CatalogStemTrackGroup,
} from "../../lib/catalogDisplay";
import { CatalogArtistCard } from "./CatalogArtistCard";
import { CatalogReleaseCard } from "./CatalogReleaseCard";
import { CatalogStemTrackRow } from "./CatalogStemTrackRow";

const DAY = 86_400_000;

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
    createdAt: new Date(Date.now() - 3 * DAY).toISOString(),
    aiDisclosure: { level: "partly", facets: [] },
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

/** The stretched title link, which must never wrap an interactive button. */
function titleLink(html: string) {
  const match = html.match(/<a [^>]*class="ng-cat-card__link"[^>]*>[\s\S]*?<\/a>/);
  expect(match).not.toBeNull();
  return match![0];
}

describe("CatalogReleaseCard", () => {
  it("renders title, credited artist, meta line, and a visible AI disclosure label", () => {
    const html = renderToStaticMarkup(<CatalogReleaseCard release={makeRelease()} />);
    expect(html).toContain('href="/release/rel-1"');
    expect(html).toContain(">Lovebird</a>");
    expect(html).toContain("Nova");
    expect(html).toContain("Single · Pop · 3d ago");
    expect(html).toContain("AI-assisted");
    expect(html).toContain("ng-cat-card__ai");
  });

  it("omits the genre from the meta line when it is missing", () => {
    const html = renderToStaticMarkup(
      <CatalogReleaseCard release={makeRelease({ genre: null, type: "ep" })} />,
    );
    expect(html).toContain("EP · 3d ago");
  });

  it("shows the play button only with an onPlay handler and at least one track", () => {
    const onPlay = vi.fn();
    const playable = renderToStaticMarkup(<CatalogReleaseCard release={makeRelease()} onPlay={onPlay} />);
    expect(playable).toContain('aria-label="Play Lovebird"');
    expect(playable).toContain("ng-cat-card__play");

    const noHandler = renderToStaticMarkup(<CatalogReleaseCard release={makeRelease()} />);
    expect(noHandler).not.toContain("ng-cat-card__play");

    const noTracks = renderToStaticMarkup(
      <CatalogReleaseCard release={makeRelease({ tracks: [] })} onPlay={onPlay} />,
    );
    expect(noTracks).not.toContain("ng-cat-card__play");
  });

  it("renders secondary actions as labelled buttons outside the title link", () => {
    const html = renderToStaticMarkup(
      <CatalogReleaseCard
        release={makeRelease()}
        onPlay={vi.fn()}
        actions={[
          { icon: "playlist_add", label: "Add Lovebird to playlist", onClick: vi.fn() },
          { icon: "library_add", label: "Save Lovebird to library", onClick: vi.fn(), busy: true },
        ]}
      />,
    );
    expect(html).toContain('aria-label="Add Lovebird to playlist"');
    expect(html).toContain('title="Add Lovebird to playlist"');
    expect(html).toContain('aria-label="Save Lovebird to library"');
    expect(html).toContain("progress_activity");
    expect(html.match(/<button/g)).toHaveLength(3);
    expect(titleLink(html)).not.toContain("<button");
  });

  it("falls back to a monogram without artwork and uses the stored artwork otherwise", () => {
    const monogram = renderToStaticMarkup(<CatalogReleaseCard release={makeRelease()} />);
    expect(monogram).toContain("ng-cat-monogram");

    const stored = renderToStaticMarkup(
      <CatalogReleaseCard release={makeRelease({ artworkMimeType: "image/jpeg", artworkRevision: 2 })} />,
    );
    expect(stored).toContain("%2Fcatalog%2Freleases%2Frel-1%2Fartwork%2Fv2");
    expect(stored).not.toContain("ng-cat-monogram");
  });
});

describe("CatalogArtistCard", () => {
  const artist: CatalogArtistSummary = {
    key: "public-nova",
    name: "Nova",
    artistId: "public-nova",
    releaseCount: 1,
    stemCount: 7,
    latestRelease: makeRelease(),
    latestAt: Date.now(),
    genres: new Set(["Pop"]),
  };

  it("pluralizes counts and links to the credited profile", () => {
    const html = renderToStaticMarkup(<CatalogArtistCard artist={artist} />);
    expect(html).toContain('href="/artist/public-nova"');
    expect(html).toContain("1 release · 7 stems");
    expect(html).not.toContain("1 releases");
    expect(html).toContain("Pop");
  });

  it("uses singular stems and the catalog credit page without a clear identity", () => {
    const html = renderToStaticMarkup(
      <CatalogArtistCard artist={{ ...artist, artistId: null, releaseCount: 2, stemCount: 1 }} />,
    );
    expect(html).toContain('href="/catalog/artists/Nova"');
    expect(html).toContain("2 releases · 1 stem");
  });
});

describe("CatalogStemTrackRow", () => {
  const group: CatalogStemTrackGroup = {
    key: "rel-1:trk-1",
    trackId: "trk-1",
    releaseId: "rel-1",
    trackTitle: "Lovebird",
    releaseTitle: "Lovebird EP",
    artistName: "Nova",
    artworkUrl: null,
    stemTypes: ["original", "vocals", "drums", "bass", "other", "synth"],
    stemCount: 7,
  };

  it("renders one mixer link per track with ordered sentence-case tags and a stem count", () => {
    const [grouped] = groupCatalogStemsByTrack(
      ["synth", "other", "bass", "drums", "vocals", "original", "vocals"].map((type, index) => ({
        id: `stem-${index}`,
        releaseId: "rel-1",
        releaseTitle: "Lovebird EP",
        trackId: "trk-1",
        trackTitle: "Lovebird",
        title: type,
        type,
        artistName: "Nova",
        artworkUrl: null,
        createdAt: "2026-09-01T00:00:00.000Z",
      })),
    );
    const html = renderToStaticMarkup(<CatalogStemTrackRow group={grouped} />);
    expect(html).toContain('href="/release/rel-1?mixer=true"');
    expect(html).toContain("Lovebird EP · Nova");
    const tags = Array.from(html.matchAll(/class="ng-cat-stem__tag">([^<]+)</g)).map((match) => match[1]);
    expect(tags).toEqual(["Full mix", "Vocals", "Drums", "Bass", "Other", "Synth"]);
    expect(html).toContain("7 stems");
  });

  it("singularizes a one-stem track", () => {
    const html = renderToStaticMarkup(
      <CatalogStemTrackRow group={{ ...group, stemTypes: ["vocals"], stemCount: 1 }} />,
    );
    expect(html).toContain(">1 stem<");
  });
});
