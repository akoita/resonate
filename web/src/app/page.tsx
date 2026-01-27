"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { useAuth } from "../components/auth/AuthProvider";
import { usePlayer } from "../lib/playerContext";
import { listPublishedTracks, listMyTracks, Track } from "../lib/api";
import { LocalTrack } from "../lib/localLibrary";

export default function Home() {
  const { playQueue } = usePlayer();
  const moods = ["Focus", "Chill", "Energy", "Night Drive", "Lo-fi"];
  const [releases, setReleases] = useState<Track[]>([]);
  const [myTracks, setMyTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const { token, status } = useAuth();

  useEffect(() => {
    listPublishedTracks(8)
      .then(setReleases)
      .catch(() => setReleases([]))
      .finally(() => setLoading(false));

    if (token && status === "authenticated") {
      listMyTracks(token)
        .then(setMyTracks)
        .catch(() => setMyTracks([]));
    }
  }, [token, status]);

  const handlePlayAll = () => {
    if (releases.length > 0) {
      const playableReleases: LocalTrack[] = releases.map((t) => ({
        id: t.id,
        title: t.title,
        artist: t.primaryArtist || "Unknown Artist",
        albumArtist: null,
        album: t.releaseTitle || null,
        year: t.releaseDate ? new Date(t.releaseDate).getFullYear() : null,
        genre: t.genre || null,
        duration: 0,
        createdAt: t.createdAt,
        remoteUrl: t.stems && t.stems.length > 0 ? t.stems[0].uri : undefined,
      }));
      void playQueue(playableReleases, 0);
    }
  };

  const curated = ["Deep Flow", "Momentum", "Calm Waves", "Pulse"];

  return (
    <main>
      <section className="home-hero">
        <div className="home-title">Resonate</div>
        <div className="home-subtitle">
          Enter the master stage. Stream high-fidelity stems, explore curated collections, or architect your next sonic release.
        </div>
        <div className="home-actions">
          <Button onClick={handlePlayAll} className="btn-start-session">Start session</Button>
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

      {status === "authenticated" && myTracks.length > 0 && (
        <section className="home-section">
          <div className="home-section-title">Your Uploads</div>
          <div className="card-grid">
            {myTracks.map((track) => (
              <Link key={track.id} href={`/player?trackId=${track.id}`}>
                <Card title={track.releaseTitle || track.title}>
                  <div className="track-card-meta">
                    <span className={`status-badge status-${track.status.toLowerCase()}`}>
                      {track.status}
                    </span>
                    <span className="track-card-date">
                      {new Date(track.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

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

