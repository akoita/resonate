"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getArtistPublic, listArtistReleases, Release, ArtistProfile } from "../../../lib/api";
import { Card } from "../../../components/ui/Card";
import { Button } from "../../../components/ui/Button";
import { Tabs } from "../../../components/ui/Tabs";
import { ArtistCommunityTab } from "../../../components/community/ArtistCommunityTab";

type ArtistTab = "discography" | "community";

export default function ArtistPage() {
    const params = useParams();
    const router = useRouter();
    const artistId = typeof params.id === 'string' ? decodeURIComponent(params.id) : null;

    const [artist, setArtist] = useState<ArtistProfile | null>(null);
    const [placeholderName, setPlaceholderName] = useState<string>("");

    const [releases, setReleases] = useState<Release[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<ArtistTab>("discography");

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
                                    RESONATE PROFILE
                                </span>
                            ) : null}
                        </div>
                        <h1 className="artist-name-lg text-gradient">
                            {artist?.displayName || placeholderName || "Unknown Artist"}
                        </h1>
                        <p className="artist-stats">
                            {loading
                                ? "Loading catalog"
                                : `${releases.length} official release${releases.length !== 1 ? "s" : ""}`}
                        </p>
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
