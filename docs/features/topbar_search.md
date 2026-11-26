# Search in the top bar

Status: `done` ([#2671](https://github.com/akoita/resonate/issues/2671),
Vision Sprint 60 "Ready to show").

Revenue line: vision-neutral usability. No fee, split, price or payout change.

## What it is

A search field in the top bar of every page. It finds artists, releases,
tracks and public playlists by name and shows them grouped in a results panel
under the field.

- `/` (when not typing in another field) or Ctrl+K / Cmd+K focuses it.
- Two characters minimum; requests are debounced (250 ms) and a newer query
  aborts the older request.
- Combobox pattern: the input is `role="combobox"` with `aria-controls` and
  `aria-activedescendant`; results are a `listbox` with one labelled `group`
  per kind. Arrow keys move (with wrap-around), Enter opens, Escape closes and
  then clears. A polite live region announces the result count.
- On a phone (under 768 px) a magnifying-glass button opens the field across
  the bar, with results below it.
- A track opens the page of its release.

## Backend

`GET /search?q=` (public, rate limited to 60 requests a minute per client)
returns `{ query, artists, releases, tracks, playlists }`, at most five of
each. The query is trimmed, its spaces collapsed and cut to 80 characters;
shorter than two characters answers empty groups.

Every group applies the playable-content rule:

- tracks match `PLAYABLE_TRACK_WHERE`;
- releases are `ready` or `published`, on a public rights route, with at least
  one playable track;
- artists are listed only with at least one such release. The group also
  lists credited artist names (a release's `primaryArtist`, for imported or
  label releases with no artist account) from listed releases only; a credit
  that matches an artist account's name is shown once, as the account. A
  credit links to the catalog credit page (`/catalog/artists/<name>`);
- playlists come from the public playlist feed narrowed by name
  (`listPublicPlaylists({ query })`), which already drops playlists with no
  playable track.

So a withdrawn, unfinished, taken-down or restricted release, and a private
playlist, never appear (`search.integration.spec.ts`).

## Code

- Backend: `backend/src/modules/search/` (`SearchService`, `SearchController`).
- Web: `web/src/components/layout/TopbarSearch.tsx`, `web/src/lib/search.ts`,
  `web/src/styles/topbar-search.css`.
- User Guide: "Search from any page" in *Discover & browse music*.
