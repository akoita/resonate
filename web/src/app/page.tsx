"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { listPublishedTracks, Track } from "../lib/api";

export default function Home() {
  const moods = ["Focus", "Chill", "Energy", "Night Drive", "Lo-fi"];
  const [releases, setReleases] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listPublishedTracks(8)
      .then(setReleases)
      .catch(() => setReleases([]))
      .finally(() => setLoading(false));
  }, []);

  const curated = ["Deep Flow", "Momentum", "Calm Waves", "Pulse"];

  return (
    <main>
      <section className="home-hero">
        <div className="home-title">Resonate</div>
        <div className="home-subtitle">
          Start a session, explore new artists, or upload your next release.
        </div>
        <div className="home-actions">
          <Button>Start session</Button>
          <Link href="/artist/upload">
            <Button variant="ghost">Upload stems</Button>
          </Link>
        </div>
        <div className="home-chips">
          {moods.map((mood) => (
            <button key={mood} className="home-chip" type="button">
              {mood}
            </button>
          ))}
        </div>
      </section>

      <section className="home-section">
        <div className="home-section-title">New Releases</div>
        {loading ? (
          <div className="home-subtitle">Loading releases...</div>
        ) : releases.length === 0 ? (
          <div className="home-subtitle">
            No releases yet.{" "}
            <Link href="/artist/upload" style={{ color: "var(--color-accent)" }}>
              Upload your first track
            </Link>
          </div>
        ) : (
          <div className="card-grid">
            {releases.map((track) => (
              <Link key={track.id} href={`/player?trackId=${track.id}`}>
                <Card title={track.releaseTitle || track.title}>
                  <div className="track-card-meta">
                    <span>{track.primaryArtist || "Unknown Artist"}</span>
                    <span className="track-card-status">{track.status}</span>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="home-section">
        <div className="home-section-title">AI Curated</div>
        <div className="card-grid">
          {curated.map((name) => (
            <Card key={name} title={name}>
              Personalized mix · 4:10
            </Card>
          ))}
        </div>
      </section>
    </main>
  );
}

