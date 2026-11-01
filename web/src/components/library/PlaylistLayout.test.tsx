/**
 * The shared playlist row: the owner's page and the public link draw the same
 * row, and a track's actions sit behind a quiet "⋯" button, not a big
 * "Remove" button on every row.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PlaylistHero, PlaylistTrackRow, RowMenuButton } from "./PlaylistLayout";

const noop = () => {};

describe("playlist track row", () => {
  it("numbers the row and shows its length", () => {
    const html = renderToStaticMarkup(
      <PlaylistTrackRow index={4} title="Allah" meta="Tiken Jah Fakoly" duration={243} />,
    );
    expect(html).toContain('class="pl-track-number">5<');
    expect(html).toContain("4:03");
    expect(html).not.toContain("pl-track-grip");
  });

  it("offers a drag grip only on rows the owner can reorder", () => {
    const html = renderToStaticMarkup(
      <PlaylistTrackRow index={0} title="Energy" meta="Keri Hilson" duration={null} reorderable />,
    );
    expect(html).toContain("is-reorderable");
    expect(html).toContain("pl-track-grip");
  });

  it("puts the actions behind a labelled menu button instead of a Remove button", () => {
    const html = renderToStaticMarkup(
      <PlaylistTrackRow
        index={0}
        title="La dot"
        meta="Aya Nakamura"
        duration={180}
        menu={<RowMenuButton label="More options for La dot" expanded={false} onOpen={noop} onClose={noop} />}
      />,
    );
    expect(html).toContain('aria-label="More options for La dot"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toMatch(/>Remove</);
  });
});

describe("row menu button", () => {
  it("is a tab stop by default", () => {
    const html = renderToStaticMarkup(<RowMenuButton label="Options" expanded onOpen={noop} onClose={noop} />);
    expect(html).not.toContain("tabindex");
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("is-open");
  });

  it("leaves the tab order to a listbox that opens it with the Menu key", () => {
    const html = renderToStaticMarkup(
      <RowMenuButton label="Options" expanded={false} onOpen={noop} onClose={noop} tabbable={false} />,
    );
    expect(html).toContain('tabindex="-1"');
  });
});

describe("playlist hero", () => {
  it("makes the title a rename button only for the owner", () => {
    const owner = renderToStaticMarkup(
      <PlaylistHero artUrl={null} name="youss-favorites" label="Playlist" meta="9 tracks" actions={null} onRename={noop} />,
    );
    const visitor = renderToStaticMarkup(
      <PlaylistHero artUrl={null} name="youss-favorites" label="Public playlist" meta="9 tracks" actions={null} />,
    );
    expect(owner).toContain('class="pl-hero-rename"');
    expect(visitor).not.toContain("pl-hero-rename");
    expect(visitor).toContain("youss-favorites");
  });
});
