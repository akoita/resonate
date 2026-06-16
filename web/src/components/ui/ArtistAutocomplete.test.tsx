import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/api", () => ({
  searchArtists: vi.fn(async () => []),
}));

import { ArtistAutocomplete, ArtistTagInput } from "./ArtistAutocomplete";

describe("ArtistAutocomplete", () => {
  it("renders the current value and reuse/create guidance", () => {
    const html = renderToStaticMarkup(
      <ArtistAutocomplete token="t" value="Bouba" onChange={() => {}} />,
    );
    expect(html).toContain('value="Bouba"');
    expect(html).toContain("keep typing to create a new one");
  });

  it("shows the placeholder and no hint when empty", () => {
    const html = renderToStaticMarkup(
      <ArtistAutocomplete token="t" value="" onChange={() => {}} placeholder="Aya Lune" />,
    );
    expect(html).toContain('placeholder="Aya Lune"');
    expect(html).not.toContain("artist-suggest__hint");
  });
});

describe("ArtistTagInput", () => {
  it("renders comma-separated values as removable chips", () => {
    const html = renderToStaticMarkup(
      <ArtistTagInput token="t" value="Calista, Mara" onChange={() => {}} />,
    );
    expect(html).toContain("Calista");
    expect(html).toContain("Mara");
    expect(html).toContain("Remove Calista");
    expect(html).toContain("Remove Mara");
  });

  it("shows the placeholder only when there are no chips", () => {
    const withChips = renderToStaticMarkup(
      <ArtistTagInput token="t" value="Calista" onChange={() => {}} placeholder="Add featured" />,
    );
    expect(withChips).not.toContain('placeholder="Add featured"');

    const empty = renderToStaticMarkup(
      <ArtistTagInput token="t" value="" onChange={() => {}} placeholder="Add featured" />,
    );
    expect(empty).toContain('placeholder="Add featured"');
  });
});
