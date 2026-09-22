import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/api", () => ({
  searchArtists: vi.fn(async () => []),
}));

import { ArtistAutocomplete, ArtistTagInput, buildSuggestState } from "./ArtistAutocomplete";
import type { ArtistSearchResult } from "../../lib/api";

const artist = (id: string, displayName: string): ArtistSearchResult => ({
  id,
  displayName,
  profileType: "public_artist",
  claimStatus: "unclaimed",
});

describe("buildSuggestState", () => {
  it("defaults to the single exact match and offers no create row", () => {
    const state = buildSuggestState({
      suggestions: [artist("a1", "Bouba Band"), artist("a2", "Bouba")],
      query: " bouba ",
      allowCreateRow: true,
    });
    expect(state.exactMatches.map((a) => a.id)).toEqual(["a2"]);
    expect(state.showCreate).toBe(false);
    expect(state.options).toHaveLength(2);
    expect(state.defaultIndex).toBe(1);
    expect(state.duplicateNames.size).toBe(0);
  });

  it("forces an explicit choice when several artists share the exact name", () => {
    const state = buildSuggestState({
      suggestions: [artist("a1", "Bouba"), artist("a2", "bouba "), artist("a3", "Boubacar")],
      query: "Bouba",
      allowCreateRow: true,
    });
    expect(state.exactMatches.map((a) => a.id)).toEqual(["a1", "a2"]);
    expect(state.defaultIndex).toBe(-1);
    expect(state.showCreate).toBe(true);
    expect(state.options[state.options.length - 1]).toEqual({ kind: "create", name: "Bouba" });
    expect([...state.duplicateNames]).toEqual(["bouba"]);
  });

  it("defaults to the create row when nothing matches exactly", () => {
    const state = buildSuggestState({
      suggestions: [artist("a1", "Boubacar")],
      query: "Bouba",
      allowCreateRow: true,
    });
    expect(state.exactMatches).toHaveLength(0);
    expect(state.showCreate).toBe(true);
    expect(state.defaultIndex).toBe(1);
    expect(state.options[1]).toEqual({ kind: "create", name: "Bouba" });
  });

  it("never offers a create row when allowCreateRow is false", () => {
    const none = buildSuggestState({
      suggestions: [artist("a1", "Boubacar")],
      query: "Bouba",
      allowCreateRow: false,
    });
    expect(none.showCreate).toBe(false);
    expect(none.options).toHaveLength(1);
    expect(none.defaultIndex).toBe(0);

    const empty = buildSuggestState({ suggestions: [], query: "Bouba", allowCreateRow: false });
    expect(empty.options).toHaveLength(0);
    expect(empty.defaultIndex).toBe(-1);
  });
});

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

  it("asks for an exact profile pick when linksProfile is set", () => {
    const html = renderToStaticMarkup(
      <ArtistAutocomplete token="t" value="Bouba" onChange={() => {}} linksProfile />,
    );
    expect(html).toContain("Pick a profile from the list to credit it exactly");
    expect(html).not.toContain("keep typing to create a new one");
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
