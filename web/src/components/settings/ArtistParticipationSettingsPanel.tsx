"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getArtistMe, type ArtistProfile } from "../../lib/api";
import { ArtistParticipationPanel } from "../participation/ArtistParticipationPanel";

type Props = {
  token: string | null | undefined;
};

/**
 * Settings → Artist (#2666): the participation agreement the artist accepted
 * and their consent choices, which replace the single remix switch.
 */
export default function ArtistParticipationSettingsPanel({ token }: Props) {
  const [artist, setArtist] = useState<ArtistProfile | null | undefined>(undefined);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    getArtistMe(token)
      .then((profile) => {
        if (!cancelled) setArtist(profile);
      })
      .catch(() => {
        if (!cancelled) setArtist(null);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <div>
          <h3 className="settings-section-title">Agreement and consent</h3>
          <p className="home-subtitle">
            The artist participation agreement you accepted, and how your music may be used.
          </p>
        </div>
      </div>
      {artist === undefined ? (
        <p className="home-subtitle" role="status">Loading…</p>
      ) : artist === null || !token ? (
        <div className="artist-remix-empty">
          <strong>No artist profile connected</strong>
          <p>Create an artist profile to read the agreement and set your choices.</p>
          <Link href="/artist/onboarding">Set up an artist profile</Link>
        </div>
      ) : (
        <ArtistParticipationPanel token={token} artistId={artist.id} mode="settings" />
      )}
    </div>
  );
}
