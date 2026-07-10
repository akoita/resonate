"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getArtistPublic, getArtistMe, listArtistReleases, Release, ArtistProfile } from "../../../lib/api";
import { Card } from "../../../components/ui/Card";
import { Button } from "../../../components/ui/Button";
import { Tabs } from "../../../components/ui/Tabs";
import { ArtistCommunityTab } from "../../../components/community/ArtistCommunityTab";
import { ArtistSocialLinksRow } from "../../../components/artist/ArtistSocialLinksRow";
import { ArtistProfileEditor } from "../../../components/artist/ArtistProfileEditor";
import { isArtistProfileOwner } from "../../../lib/artistProfileForm";
import { useAuth } from "../../../components/auth/AuthProvider";

type ArtistTab = "discography" | "community";

export default function ArtistPage() {
    const params = useParams();
    const router = useRouter();
    const { token } = useAuth();
    const artistId = typeof params.id === 'string' ? decodeURIComponent(params.id) : null;

    const [artist, setArtist] = useState<ArtistProfile | null>(null);
    const [me, setMe] = useState<ArtistProfile | null>(null);
    const [placeholderName, setPlaceholderName] = useState<string>("");

    const [releases, setReleases] = useState<Release[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<ArtistTab>("discography");
    const isOwner = isArtistProfileOwner(me, artist);

    useEffect(() => {
        const tab = new URLSearchParams(window.location.search).get("tab");
        if (tab === "community" || tab === "discography") {
            setActiveTab(tab);
        }
    }, []);

    useEffect(() => {
        if (!artistId) return;

        setLoading(true);
        setPlaceholderName(artistId);

        const fetchData = async () => {
            try {
                const [profile, profileReleases] = await Promise.all([
                    getArtistPublic(artistId).catch(() => null),
                    listArtistReleases(artistId).catch(() => []),
                ]);

                setArtist(profile);
                setReleases(profileReleases);

            } catch (err) {
                console.error("Failed to load artist", err);
                setArtist(null);
                setReleases([]);
            } finally {
                setLoading(false);
            }
        };

        void fetchData();
    }, [artistId]);

    // Owner detection (#1419): only fetched when signed in, and only used to
    // gate the "Edit profile" affordance below — never blocks the public view.
    useEffect(() => {
        if (!token) {
            setMe(null);
            return;
        }
        let cancelled = false;
        getArtistMe(token)
            .then((profile) => {
                if (!cancelled) setMe(profile);
            })
            .catch(() => {
                if (!cancelled) setMe(null);
            });
        return () => {
            cancelled = true;
        };
    }, [token]);

    const handleBack = () => {
        router.back();
    };

    const coverArt = artist?.imageUrl || releases.find((r) => r.artworkUrl)?.artworkUrl || null;
    const trackCount = releases.reduce((sum, r) => sum + (r.tracks?.length ?? 0), 0);
    const genres = Array.from(
        new Set(releases.map((r) => r.genre).filter((g): g is string => Boolean(g))),
    ).slice(0, 4);

    return (
        <div className="page-container artist-page">
            <div className="artist-hero glass-panel">
                {coverArt ? (
                    <div
                        className="artist-hero__backdrop"
                        style={{ backgroundImage: `url(${coverArt})` }}
                        aria-hidden="true"
                    />
                ) : null}
                <Button variant="ghost" className="back-btn" onClick={handleBack}>
                    ← Back
                </Button>
                <div className="artist-hero-content">
                    <div className="artist-avatar-lg placeholder-avatar">
                        {artist?.imageUrl ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img src={artist.imageUrl} alt={artist.displayName} className="artist-avatar-img" />
                        ) : (
                            artist?.displayName?.[0] || placeholderName?.[0] || "A"
                        )}
                    </div>
                    <div className="artist-info">
                        <div className="flex items-center gap-3 mb-3">
                            <span className="artist-label mb-0">Artist</span>
                            {artist ? (
                                <span className="artist-verified-badge">RESONATE PROFILE</span>
                            ) : null}
                        </div>
                        <h1 className="artist-name-lg text-gradient">
                            {artist?.displayName || placeholderName || "Unknown Artist"}
                        </h1>
                        <p className="artist-stats">
                            {loading ? (
                                "Loading catalog"
                            ) : (
                                <>
                                    <span>{releases.length} release{releases.length !== 1 ? "s" : ""}</span>
                                    {trackCount > 0 ? (
                                        <>
                                            <span className="artist-stats__dot">·</span>
                                            <span>{trackCount} track{trackCount !== 1 ? "s" : ""}</span>
                                        </>
                                    ) : null}
                                </>
                            )}
                        </p>
                        {genres.length > 0 ? (
                            <div className="artist-genres">
                                {genres.map((g) => (
                                    <span key={g} className="artist-genre-chip">{g}</span>
                                ))}
                            </div>
                        ) : null}
                        {artist?.summary ? (
                            <p className="artist-bio">{artist.summary}</p>
                        ) : null}
                        <ArtistSocialLinksRow website={artist?.website} socialLinks={artist?.socialLinks} />
                        {artist ? (
                            <ArtistProfileEditor
                                artist={artist}
                                isOwner={isOwner}
                                onSaved={(updated) => setArtist(updated)}
                            />
                        ) : null}
                    </div>
                </div>
            </div>

            <Tabs
                items={[
                    { id: "discography", label: "Discography" },
                    { id: "community", label: "Community" },
                ]}
                activeId={activeTab}
                onChange={(id) => setActiveTab(id as ArtistTab)}
            />

            {activeTab === "discography" && (releases.length > 0 || loading) && (
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
                            {releases.map((release) => (
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

            {activeTab === "discography" && !loading && releases.length === 0 && (
                <div className="empty-state">
                    <p>No official releases found for this artist profile.</p>
                </div>
            )}

            {activeTab === "community" && artistId && (
                <ArtistCommunityTab artistId={artistId} artist={artist} />
            )}
        </div>
    );
}
