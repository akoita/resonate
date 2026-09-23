"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { getArtistPublic, getArtistManagementAccess, getMyArtistClaim, listArtistReleases, listPublishedReleases, Release, ArtistProfile, type ArtistClaim, type ResourceManagementAccess } from "../../../lib/api";
import { Card } from "../../../components/ui/Card";
import { Button } from "../../../components/ui/Button";
import { Tabs } from "../../../components/ui/Tabs";
import { ArtistCommunityTab } from "../../../components/community/ArtistCommunityTab";
import { ArtistSocialLinksRow } from "../../../components/artist/ArtistSocialLinksRow";
import { ArtistProfileEditor } from "../../../components/artist/ArtistProfileEditor";
import { ArtistClaimCallout } from "../../../components/artist/ArtistClaimCallout";
import { useAuth } from "../../../components/auth/AuthProvider";
import { legacyArtistAliasDestination, legacyArtistAliasSearchName, libraryArtistHref, publicReleaseHref } from "../../../lib/artistRoutes";
import { summarizeCreditedArtists } from "../../../lib/catalogDisplay";
import { listTracks } from "../../../lib/localLibrary";
import { libraryArtistNameForProfile } from "../../../lib/libraryNavigation";
import { catalogArtistPlaybackTracks } from "../../../lib/catalogArtistPlayback";
import { usePlayer } from "../../../lib/playerContext";
import { QueueActionsButton } from "../../../components/player/QueueActionsButton";

type ArtistTab = "discography" | "community";

export default function ArtistPage() {
    const params = useParams();
    const router = useRouter();
    const { token, login } = useAuth();
    const { playQueue } = usePlayer();
    const artistId = typeof params.id === 'string' ? decodeURIComponent(params.id) : null;

    const [artist, setArtist] = useState<ArtistProfile | null>(null);
    const [managementAccess, setManagementAccess] = useState<ResourceManagementAccess | null>(null);
    const [claim, setClaim] = useState<ArtistClaim | null>(null);
    const [placeholderName, setPlaceholderName] = useState<string>("");

    const [releases, setReleases] = useState<Release[]>([]);
    const [loading, setLoading] = useState(true);
    const [notFound, setNotFound] = useState(false);
    const [libraryArtistName, setLibraryArtistName] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<ArtistTab>("discography");
    const canEditProfile = managementAccess?.resourceId === artist?.id
        && managementAccess?.currentUserAccess.scopes.includes("PROFILE_EDIT") === true;
    const playbackTracks = useMemo(() => catalogArtistPlaybackTracks(releases), [releases]);

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

                if (profile) {
                    setArtist(profile);
                    setReleases(profileReleases);
                    setNotFound(false);
                    return;
                }

                // Legacy /artist/{slug} aliases must not render an empty
                // second profile. Resolve only from public catalog evidence;
                // otherwise show an explicit not-found state (#1820).
                const catalogReleases = await listPublishedReleases(
                    100,
                    legacyArtistAliasSearchName(artistId),
                ).catch(() => []);
                const legacyDestination = legacyArtistAliasDestination(
                    artistId,
                    summarizeCreditedArtists(catalogReleases),
                );
                if (legacyDestination) {
                    router.replace(legacyDestination);
                    return;
                }

                setArtist(null);
                setReleases([]);
                setNotFound(true);

            } catch (err) {
                console.error("Failed to load artist", err);
                setArtist(null);
                setReleases([]);
            } finally {
                setLoading(false);
            }
        };

        void fetchData();
    }, [artistId, router]);

    useEffect(() => {
        if (!artist?.id || !token) {
            setLibraryArtistName(null);
            return;
        }
        let cancelled = false;
        listTracks()
            .then((tracks) => {
                if (!cancelled) {
                    setLibraryArtistName(libraryArtistNameForProfile(artist.id, tracks));
                }
            })
            .catch(() => {
                if (!cancelled) setLibraryArtistName(null);
            });
        return () => {
            cancelled = true;
        };
    }, [artist?.id, token]);

    // Server-resolved access replaces local Artist.userId inference, which would
    // incorrectly keep showing edit controls after a management transfer.
    useEffect(() => {
        if (!token || !artistId) {
            setManagementAccess(null);
            return;
        }
        let cancelled = false;
        getArtistManagementAccess(token, artistId)
            .then((access) => {
                if (!cancelled) setManagementAccess(access);
            })
            .catch(() => {
                if (!cancelled) setManagementAccess(null);
            });
        return () => {
            cancelled = true;
        };
    }, [token, artistId]);

    useEffect(() => {
        if (!token || !artistId) {
            setClaim(null);
            return;
        }
        let cancelled = false;
        getMyArtistClaim(token, artistId)
            .then((request) => { if (!cancelled) setClaim(request); })
            .catch(() => { if (!cancelled) setClaim(null); });
        return () => { cancelled = true; };
    }, [token, artistId]);

    const handleBack = () => {
        router.push("/catalog?view=artists");
    };

    const isUnclaimedPublicArtist =
        artist?.profileType === "public_artist" && artist.claimStatus === "unclaimed";

    const coverArt = artist?.imageUrl || releases.find((r) => r.artworkUrl)?.artworkUrl || null;
    const trackCount = releases.reduce((sum, r) => sum + (r.tracks?.length ?? 0), 0);
    const genres = Array.from(
        new Set(releases.map((r) => r.genre).filter((g): g is string => Boolean(g))),
    ).slice(0, 4);

    if (!loading && notFound) {
        return (
            <div className="page-container artist-page">
                <div className="empty-state" role="status">
                    <h1>Artist not found</h1>
                    <p>This artist profile or catalog credit could not be resolved.</p>
                    <Button variant="ghost" onClick={handleBack}>← Back</Button>
                </div>
            </div>
        );
    }

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
                    ← Back to Artists
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
                                isUnclaimedPublicArtist ? (
                                    <span className="artist-verified-badge artist-verified-badge--unclaimed">Unclaimed profile</span>
                                ) : (
                                    <span className="artist-verified-badge">RESONATE PROFILE</span>
                                )
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
                        {playbackTracks.length > 0 || libraryArtistName ? (
                            <div className="library-artist-actions">
                                {playbackTracks.length > 0 ? (
                                    <>
                                        <Button variant="primary" onClick={() => void playQueue(playbackTracks, 0)}>
                                            ▶ Play all
                                        </Button>
                                        <QueueActionsButton
                                            tracks={playbackTracks}
                                            label="Queue artist"
                                            nextLabel="Play artist next"
                                        />
                                    </>
                                ) : null}
                                {libraryArtistName ? (
                                <Button
                                    variant="ghost"
                                    onClick={() => router.push(libraryArtistHref(libraryArtistName))}
                                >
                                    Open in My Library
                                </Button>
                                ) : null}
                            </div>
                        ) : null}
                        {artist ? (
                            <ArtistProfileEditor
                                artist={artist}
                                isOwner={canEditProfile}
                                onSaved={(updated) => setArtist(updated)}
                            />
                        ) : null}
                        {artist && managementAccess?.resourceId === artist.id && managementAccess.currentUserAccess.isOwner ? (
                            <Link href="/artist/management" className="artist-profile-management-link">Manage access</Link>
                        ) : null}
                        {artist && isUnclaimedPublicArtist && !canEditProfile ? (
                            <ArtistClaimCallout
                                artistId={artist.id}
                                artistName={artist.displayName}
                                token={token}
                                claim={claim?.artistId === artist.id ? claim : null}
                                onSignIn={() => void login?.()}
                                onSubmitted={setClaim}
                            />
                        ) : null}
                    </div>
                </div>
            </div>

            <Tabs
                items={[
                    { id: "discography", label: "Discography", panelId: "discography-panel" },
                    { id: "community", label: "Community", panelId: "community-panel" },
                ]}
                activeId={activeTab}
                onChange={(id) => setActiveTab(id as ArtistTab)}
            />

            <div
                id="discography-panel"
                role="tabpanel"
                aria-labelledby="discography-tab"
                hidden={activeTab !== "discography"}
            >
              {activeTab === "discography" && (
                <>
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
                            {releases.map((release) => (
                                <Card
                                    key={release.id}
                                    title={release.title}
                                    image={release.artworkUrl || undefined}
                                    variant="standard"
                                    onClick={() => router.push(publicReleaseHref(release.id))}
                                >
                                    <div className="card-meta">
                                        <span className="card-type">{release.type}</span>
                                        <span className="card-year">
                                            · {release.releaseDate ? new Date(release.releaseDate).getFullYear() : ""}
                                        </span>
                                    </div>
                                </Card>
                            ))}
                        </div>
                    )}
                    </>
                  )}

                  {!loading && releases.length === 0 && (
                    <div className="empty-state">
                        <p>No official releases found for this artist profile.</p>
                    </div>
                  )}
                </>
              )}
            </div>

            <div
                id="community-panel"
                role="tabpanel"
                aria-labelledby="community-tab"
                hidden={activeTab !== "community"}
            >
              {activeTab === "community" && artistId && (
                  <ArtistCommunityTab artistId={artistId} artist={artist} />
              )}
            </div>
        </div>
    );
}
