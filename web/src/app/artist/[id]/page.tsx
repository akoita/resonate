"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getArtistPublic, listArtistReleases, Release, ArtistProfile } from "../../../lib/api";
import { listTracks, LocalTrack } from "../../../lib/localLibrary";
import { Card } from "../../../components/ui/Card";
import { Button } from "../../../components/ui/Button";

export default function ArtistPage() {
    const params = useParams();
    const router = useRouter();
    const artistId = typeof params.id === 'string' ? decodeURIComponent(params.id) : null;

    const [artist, setArtist] = useState<ArtistProfile | null>(null);
    const [placeholderName, setPlaceholderName] = useState<string>("");

    const [releases, setReleases] = useState<Release[]>([]);
    const [loading, setLoading] = useState(true);
    const [localTracks, setLocalTracks] = useState<LocalTrack[]>([]);

    useEffect(() => {
        if (!artistId) return;

        setLoading(true);
        setPlaceholderName(artistId);

        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(artistId);

        const fetchData = async () => {
            try {
                const promises: Promise<void>[] = [];

                // 1. Fetch from API if UUID
                if (isUuid) {
                    promises.push(getArtistPublic(artistId).catch(() => null).then(p => setArtist(p)));
                    promises.push(listArtistReleases(artistId).catch(() => []).then(r => setReleases(r)));
                }

                // 2. Fetch from Local Library (IndexedDB)
                promises.push(
                    listTracks().then(async (allTracks) => {
                        const matchName = artist?.displayName || artistId; // best guess
                        const filtered = allTracks.filter(t => {
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            if (isUuid && (t as any).artistId === artistId) return true;
                            if (t.artist && t.artist.toLowerCase() === matchName.toLowerCase()) return true;
                            if (isUuid && t.artist === artist?.displayName) return true;
                            return false;
                        });
                        setLocalTracks(filtered);
                    })
                );

                await Promise.all(promises);

            } catch (err) {
                console.error("Failed to load artist", err);
            } finally {
                setLoading(false);
            }
        };

        void fetchData();
    }, [artistId, artist?.displayName]);

    const handleBack = () => {
        router.back();
    };

    return (
        <div className="page-container artist-page">
            <div className="artist-hero glass-panel">
                <Button variant="ghost" className="back-btn" onClick={handleBack}>
                    ← Back
                </Button>
                <div className="artist-hero-content">
                    <div className="artist-avatar-lg placeholder-avatar">
                        {artist?.displayName?.[0] || placeholderName?.[0] || "A"}
                    </div>
                    <div className="artist-info">
                        <div className="flex items-center gap-3 mb-3">
                            <span className="artist-label mb-0">Artist</span>
                            {artist ? (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-500/20 text-purple-400 border border-purple-500/30">
                                    VERIFIED
                                </span>
                            ) : (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-white/10 text-gray-400 border border-white/10">
                                    LOCAL LIBRARY
                                </span>
                            )}
                        </div>
                        <h1 className="artist-name-lg text-gradient">
                            {artist?.displayName || placeholderName || "Unknown Artist"}
                        </h1>
                        <p className="artist-stats">
                            {releases.length > 0 ? `${releases.length} Releases` : ''}
                            {releases.length > 0 && localTracks.length > 0 ? ' • ' : ''}
                            {localTracks.length > 0 ? `${localTracks.length} Local Tracks` : ''}
                            {releases.length === 0 && localTracks.length === 0 ? 'No content' : ''}
                        </p>
                    </div>
                </div>
            </div>

            {(releases.length > 0 || loading) && (
                <>
                    <div className="section-header border-b border-white/10 pb-4 mb-6">
                        <div className="flex items-center gap-3">
                            <span className="text-xl">🌐</span>
                            <div>
                                <h2 className="text-xl font-bold">Discography</h2>
                                <p className="text-sm text-gray-400 mt-1">Official releases</p>
                            </div>
                        </div>
                    </div>

                    {loading ? (
                        <div className="loading-spinner">Loading...</div>
                    ) : (
                        <div className="releases-grid">
                            {releases.filter(release => {
                                // If we have an artist profile, ensure the release's primary artist matches reasonably well
                                if (!artist?.displayName) return true;
                                const current = artist.displayName.toLowerCase();
                                const primary = (release.primaryArtist || "").toLowerCase();
                                const featured = (release.featuredArtists || "").toLowerCase();

                                // Match if:
                                // 1. Primary artist contains the profile name (e.g. "Booba" in "Booba")
                                // 2. Profile name contains primary artist (e.g. "Booba" in "Booba ft. Kaaris" - simplistic)
                                // 3. Featured artists contains the profile name
                                // 4. If it is the user's own profile (UUID match), we might want to be more lenient, 
                                //    BUT the user explicitly asked to filter out uploads that aren't the artist.
                                //    So we enforce name matching.

                                return primary.includes(current) || current.includes(primary) || featured.includes(current);
                            }).map((release) => (
                                <Card
                                    key={release.id}
                                    title={release.title}
                                    image={release.artworkUrl || undefined}
                                    variant="standard"
                                    onClick={() => router.push(`/release/${release.id}`)}
                                >
                                    <div className="card-meta">
                                        <span className="card-type">{release.type}</span>
                                        <span className="card-year">
                                            {release.releaseDate ? new Date(release.releaseDate).getFullYear() : ""}
                                        </span>
                                    </div>
                                </Card>
                            ))}
                        </div>
                    )}
                </>
            )}

            {!loading && localTracks.length > 0 && (
                <div className="local-library-section" style={{ marginTop: '2rem' }}>
                    <div className="section-header border-b border-white/10 pb-4 mb-6">
                        <div className="flex items-center gap-3">
                            <span className="text-xl">📂</span>
                            <div>
                                <h2 className="text-xl font-bold">Your Library</h2>
                                <p className="text-sm text-gray-400 mt-1">Tracks available offline</p>
                            </div>
                        </div>
                    </div>
                    <div className="library-list">
                        {localTracks.map(track => (
                            <div key={track.id} className="library-item" style={{ gridTemplateColumns: 'auto 1fr auto' }}>
                                <div className="library-item-title">{track.title}</div>
                                <div className="library-item-album">{track.album || "—"}</div>
                                <div className="library-item-duration">
                                    {track.duration ? `${Math.floor(track.duration / 60)}:${String(Math.floor(track.duration % 60)).padStart(2, '0')}` : "--:--"}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {!loading && releases.length === 0 && localTracks.length === 0 && (
                <div className="empty-state">
                    <p>No releases found for this artist.</p>
                </div>
            )}
        </div>
    );
}
