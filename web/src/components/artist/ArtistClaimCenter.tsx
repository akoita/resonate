"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  listArtistReleases,
  listMyArtistClaims,
  searchArtistsForClaim,
  type ArtistSearchResult,
  type MyArtistClaim,
  type Release,
} from "../../lib/api";
import { ArtistClaimRequestPanel } from "./ArtistClaimRequestPanel";

type SelectedArtist = Pick<ArtistSearchResult, "id" | "displayName" | "imageUrl" | "canRequestClaim">;

export function ArtistClaimCenter({ token }: { token: string }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ArtistSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [searchNonce, setSearchNonce] = useState(0);
  const [selected, setSelected] = useState<SelectedArtist | null>(null);
  const [releases, setReleases] = useState<Release[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState(false);
  const [claims, setClaims] = useState<MyArtistClaim[]>([]);
  const [claimsLoading, setClaimsLoading] = useState(true);
  const [claimsError, setClaimsError] = useState(false);

  const chooseArtist = (artist: SelectedArtist | null) => {
    setSelected(artist);
    setReleases([]);
    setCatalogError(false);
    setCatalogLoading(Boolean(artist));
  };

  useEffect(() => {
    let active = true;
    listMyArtistClaims(token)
      .then((items) => { if (active) setClaims(items); })
      .catch(() => { if (active) setClaimsError(true); })
      .finally(() => { if (active) setClaimsLoading(false); });
    return () => { active = false; };
  }, [token]);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      setSearching(true);
      searchArtistsForClaim(token, term, 10).then((items) => {
        if (active) setResults(items);
      }).catch(() => {
        if (active) setSearchError(true);
      }).finally(() => { if (active) setSearching(false); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, token, searchNonce]);

  useEffect(() => {
    if (!selected) return;
    let active = true;
    listArtistReleases(selected.id, token)
      .then((items) => { if (active) setReleases(items); })
      .catch(() => { if (active) setCatalogError(true); })
      .finally(() => { if (active) setCatalogLoading(false); });
    return () => { active = false; };
  }, [selected, token]);

  const latestClaim = selected ? claims.find((claim) => claim.artist.id === selected.id) ?? null : null;
  const showClaimPanel = selected?.canRequestClaim === true
    || latestClaim?.status === "pending"
    || latestClaim?.status === "approved";

  return (
    <section className="glass-panel artist-claim-center" aria-labelledby="artist-claim-center-heading">
      <h2 id="artist-claim-center-heading">Request access to an artist profile</h2>
      <p className="analytics-muted">Search the credited artist, select the exact profile, and check its releases before sending evidence. A matching name or upload never grants access. An operator reviews every request.</p>

      <div className="artist-claim-center__layout">
        <div>
          <label className="artist-claim-center__search" htmlFor="artist-claim-search">Find a credited profile
            <input
              id="artist-claim-search"
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                chooseArtist(null);
                setResults([]);
                setSearching(false);
                setSearchError(false);
              }}
              placeholder="Search artist name"
              autoComplete="off"
            />
          </label>
          {query.trim().length > 0 && query.trim().length < 2 && <p className="analytics-muted">Enter at least two characters.</p>}
          {searching && <p role="status">Searching profiles…</p>}
          {searchError && <p role="alert">Profile search is unavailable. <button type="button" onClick={() => { setSearchError(false); setSearchNonce((value) => value + 1); }}>Try again</button></p>}
          {!searching && !searchError && query.trim().length >= 2 && results.length === 0 && <p className="analytics-muted">No matching credited profiles found.</p>}
          {results.length > 0 && <ul className="artist-claim-center__results" aria-label="Matching artist profiles">
            {results.map((artist) => <li key={artist.id}>
              <button type="button" className={selected?.id === artist.id ? "is-selected" : ""} onClick={() => chooseArtist(artist)}>
                <strong>{artist.displayName}</strong>
                <span>Profile {artist.id.slice(-8)} · {artist.canRequestClaim ? "Review profile" : "View status"}</span>
              </button>
            </li>)}
          </ul>}
        </div>

        <div>
          <h3>Your profile requests</h3>
          {claimsLoading && <p role="status">Loading your requests…</p>}
          {claimsError && <p role="alert">Your requests could not be loaded. Refresh the page to try again.</p>}
          {!claimsLoading && !claimsError && claims.length === 0 && <p className="analytics-muted">You have no profile requests yet.</p>}
          {claims.length > 0 && <ul className="artist-claim-center__history">
            {claims.map((claim) => <li key={claim.artist.id}>
              <button type="button" onClick={() => chooseArtist(claim.artist)}>
                <strong>{claim.artist.displayName}</strong>
                <span>{claim.status}</span>
              </button>
            </li>)}
          </ul>}
        </div>
      </div>

      {selected && <div className="artist-claim-center__selection" aria-live="polite">
        <h3>Selected profile: {selected.displayName}</h3>
        <p className="analytics-muted">Profile reference {selected.id.slice(-8)}. Check this profile and its releases carefully, especially when several artists share a name. <Link href={`/artist/${encodeURIComponent(selected.id)}`}>View public page</Link></p>
        {catalogLoading && <p role="status">Loading catalog…</p>}
        {catalogError && <p role="alert">The catalog could not be loaded. Choose this profile again to retry.</p>}
        {!catalogLoading && !catalogError && releases.length === 0 && <p className="analytics-muted">No releases appear in this public catalog. Requests may require confirmed credits.</p>}
        {!catalogLoading && !catalogError && releases.length > 0 && <ul className="artist-claim-center__releases">
          {releases.slice(0, 8).map((release) => <li key={release.id}>{release.title}{release.releaseDate ? ` · ${release.releaseDate.slice(0, 4)}` : ""}</li>)}
          {releases.length > 8 && <li>And {releases.length - 8} more releases</li>}
        </ul>}
        {!catalogLoading && !catalogError && claimsLoading && <p role="status">Checking your request status…</p>}
        {!catalogLoading && !catalogError && claimsError && <p role="alert">Request status is unavailable. Refresh before submitting evidence.</p>}
        {!catalogLoading && !catalogError && !claimsLoading && !claimsError && showClaimPanel && <ArtistClaimRequestPanel
          key={selected.id}
          artistId={selected.id}
          artistName={selected.displayName}
          token={token}
          claim={latestClaim}
          onSubmitted={(claim) => setClaims((previous) => [
            { status: claim.status, createdAt: claim.createdAt, reviewedAt: claim.reviewedAt,
              updatedAt: claim.createdAt,
              artist: { id: selected.id, displayName: selected.displayName, imageUrl: selected.imageUrl, canRequestClaim: selected.canRequestClaim === true } },
            ...previous.filter((item) => item.artist.id !== selected.id),
          ])}
        />}
        {!catalogLoading && !catalogError && !claimsLoading && !claimsError && !showClaimPanel && <p className="analytics-muted">This profile is not accepting access requests. If this is an error, contact support with the public profile link.</p>}
      </div>}
    </section>
  );
}
