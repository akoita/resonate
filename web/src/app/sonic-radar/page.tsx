"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import AuthGate from "../../components/auth/AuthGate";
import { useAuth } from "../../components/auth/AuthProvider";
import { useToast } from "../../components/ui/Toast";
import { useDiscoveryJournal } from "../../hooks/useDiscoveryJournal";
import { useUIStore } from "../../lib/uiStore";
import { saveTrackMetadataAuthenticated, saveTracksMetadata } from "../../lib/localLibrary";
import { recordProductAnalyticsFromBrowser } from "../../lib/productAnalytics";
import { getDiscoveryAttribution } from "../../lib/discoveryAttribution";
import { pendingItemToLocalTrack, pendingItems, saveDeadlineLabel } from "../../lib/sonicRadarSummary";
import type { DiscoveryJournalItem, DiscoveryJournalPendingItem } from "../../lib/api";
import {
    followUpLabel,
    formatGroupLabel,
    hasJournalItems,
    journalItemToLocalTrack,
    trackCountLabel,
} from "./journal";

export default function SonicRadarPage() {
    const { journal, isLoading, error, refetch } = useDiscoveryJournal();
    const router = useRouter();
    const { setTracksToAddToPlaylist } = useUIStore();
    const { token } = useAuth();
    const { addToast } = useToast();
    const [savingIds, setSavingIds] = useState<string[]>([]);
    const [savedIds, setSavedIds] = useState<string[]>([]);

    const addToPlaylist = async (items: DiscoveryJournalItem[]) => {
        const tracks = items.map(journalItemToLocalTrack);
        // Persist so the playlist can resolve the catalog tracks later.
        try {
            await saveTracksMetadata(tracks, "remote");
        } catch (err) {
            console.warn("[SonicRadar] Failed to save tracks to library:", err);
        }
        setTracksToAddToPlaylist(tracks);
    };

    // Saving adds the track to the library, which makes it resonate.
    const savePending = async (item: DiscoveryJournalPendingItem) => {
        if (!token) {
            addToast({ type: "info", title: "Sign in to save", message: "Connect your account to update your library." });
            return;
        }
        if (savingIds.includes(item.trackId)) return;
        setSavingIds((current) => [...current, item.trackId]);
        try {
            await saveTrackMetadataAuthenticated(pendingItemToLocalTrack(item), token);
            recordProductAnalyticsFromBrowser("library.saved", {
                subjectType: "track",
                subjectId: item.trackId,
                payload: { trackId: item.trackId, ...getDiscoveryAttribution(item.trackId) },
            });
            addToast({
                type: "success",
                title: "Saved",
                message: `"${item.title}" is in your library and your Sonic Radar.`,
            });
            setSavedIds((current) => [...current, item.trackId]);
            void refetch();
        } catch (err) {
            console.warn("[SonicRadar] Failed to save track:", err);
            addToast({ type: "error", title: "Couldn't save", message: "Please try again." });
        } finally {
            setSavingIds((current) => current.filter((id) => id !== item.trackId));
        }
    };

    const hasItems = hasJournalItems(journal);
    const visiblePending = pendingItems(journal).filter((item) => !savedIds.includes(item.trackId));
    const hasPending = visiblePending.length > 0;
    const headline = journal?.headline;

    return (
        <AuthGate title="Connect your wallet to see your discovery journal.">
            <main className="sonic-radar-page">
                {/* Hero Section */}
                <section className="sonic-radar-hero">
                    <div className="sonic-radar-hero-bg" />
                    <div className="sonic-radar-hero-content">
                        <div className="sonic-radar-icon">
                            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="2" />
                                <path d="M16.24 7.76a6 6 0 0 1 0 8.49" />
                                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                                <path d="M7.76 16.24a6 6 0 0 1 0-8.49" />
                                <path d="M4.93 19.07a10 10 0 0 1 0-14.14" />
                            </svg>
                        </div>
                        <h1 className="sonic-radar-title">
                            <span className="text-gradient">Sonic Radar</span>
                        </h1>
                        <p className="sonic-radar-subtitle">
                            Your discovery journal — the tracks that resonated: you played them through, then replayed or saved them.
                        </p>
                        {!isLoading && headline && hasItems && (
                            <div className="sonic-radar-stats">
                                <div className="sonic-radar-stat">
                                    <span className="sonic-radar-stat-value">{headline.resonantDiscoveriesThisWeek}</span>
                                    <span className="sonic-radar-stat-label">
                                        Resonant discover{headline.resonantDiscoveriesThisWeek === 1 ? "y" : "ies"} this week
                                    </span>
                                </div>
                                <div className="sonic-radar-stat-divider" />
                                <div className="sonic-radar-stat">
                                    <span className="sonic-radar-stat-value">{headline.newArtistsThisWeek}</span>
                                    <span className="sonic-radar-stat-label">
                                        New artist{headline.newArtistsThisWeek === 1 ? "" : "s"} this week
                                    </span>
                                </div>
                            </div>
                        )}
                    </div>
                </section>

                {/* Almost there: played through, one save from resonating */}
                {journal && hasPending && (
                    <section className="sonic-radar-pending" aria-labelledby="sonic-radar-pending-title">
                        <div className="sonic-radar-pending-header">
                            <h2 id="sonic-radar-pending-title">Almost there</h2>
                            <p>You played these through this week. Save the ones you liked and they join your journal.</p>
                        </div>
                        <div className="sonic-radar-grid">
                            {visiblePending.map((item) => {
                                const saving = savingIds.includes(item.trackId);
                                return (
                                    <div
                                        key={item.trackId}
                                        className="sonic-radar-card"
                                        onClick={() => router.push(`/release/${item.releaseId}`)}
                                        style={{ cursor: "pointer" }}
                                    >
                                        <div className="sonic-radar-card-art">
                                            {item.artworkUrl ? (
                                                /* eslint-disable-next-line @next/next/no-img-element */
                                                <img src={item.artworkUrl} alt={item.title} loading="lazy" />
                                            ) : (
                                                <div className="sonic-radar-card-art-placeholder">
                                                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                                        <path d="M9 18V5l12-2v13" />
                                                        <circle cx="6" cy="18" r="3" />
                                                        <circle cx="18" cy="16" r="3" />
                                                    </svg>
                                                </div>
                                            )}
                                        </div>
                                        <div className="sonic-radar-card-info">
                                            <span className="sonic-radar-card-title">{item.title}</span>
                                            <span className="sonic-radar-card-artist">{item.artistName}</span>
                                            <div className="sonic-radar-stems">
                                                {item.discovery && (
                                                    <span className="sonic-radar-stem-badge sonic-radar-stem-badge--confirmed">
                                                        New to you
                                                    </span>
                                                )}
                                                <span className="sonic-radar-stem-badge">{saveDeadlineLabel(item.followUpBy)}</span>
                                            </div>
                                        </div>
                                        <div className="sonic-radar-card-footer">
                                            <span />
                                            <button
                                                type="button"
                                                className="ui-btn ui-btn-primary ui-btn-sm sonic-radar-pending-save-btn"
                                                aria-label={`Save ${item.title}`}
                                                disabled={saving}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    void savePending(item);
                                                }}
                                            >
                                                {saving ? "Saving…" : "Save"}
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                )}

                {/* Content */}
                {isLoading && !journal ? (
                    <section className="sonic-radar-loading">
                        <div className="sonic-radar-shimmer-grid">
                            {Array.from({ length: 8 }).map((_, i) => (
                                <div key={i} className="sonic-radar-shimmer-card" />
                            ))}
                        </div>
                    </section>
                ) : error && !journal ? (
                    <section className="sonic-radar-empty">
                        <h2>Couldn&apos;t load your journal</h2>
                        <p>{error}</p>
                        <button type="button" className="ui-btn ui-btn-primary" onClick={() => void refetch()}>
                            Try again
                        </button>
                    </section>
                ) : !hasItems ? (
                    <section className="sonic-radar-empty">
                        <div className="sonic-radar-empty-icon">📡</div>
                        <h2>Your journal is quiet</h2>
                        <p>
                            {hasPending
                                ? "Nothing has resonated yet. Save or replay a track above and it will show up here."
                                : "No resonant discoveries yet — tracks you finish and then replay or save show up here."}
                        </p>
                        <Link href="/#ai-dj" className="ui-btn ui-btn-primary">
                            Start a session
                        </Link>
                    </section>
                ) : (
                    <div className="sonic-radar-feed">
                        {journal?.groups.map((group) => (
                            <section key={group.key} className="sonic-radar-group">
                                <div className="sonic-radar-group-header">
                                    <span className="sonic-radar-group-date">{formatGroupLabel(group)}</span>
                                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                                        <button
                                            className="sonic-radar-add-playlist-btn"
                                            title="Add all tracks in this group to a playlist"
                                            onClick={() => void addToPlaylist(group.items)}
                                        >
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M11 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-5" />
                                                <path d="M18 2h4v4" />
                                                <path d="M15 9l7-7" />
                                            </svg>
                                            Add to Playlist
                                        </button>
                                        <span className="sonic-radar-group-count">{trackCountLabel(group.items.length)}</span>
                                    </div>
                                </div>
                                <div className="sonic-radar-grid">
                                    {group.items.map((item) => (
                                        <div
                                            key={item.trackId}
                                            className="sonic-radar-card"
                                            draggable
                                            onDragStart={(e) => {
                                                const payload = JSON.stringify({
                                                    type: "track",
                                                    id: item.trackId,
                                                    title: item.title,
                                                    artist: item.artistName,
                                                });
                                                e.dataTransfer.setData("application/json", payload);
                                                e.dataTransfer.setData("text/plain", payload);
                                                e.dataTransfer.effectAllowed = "copy";
                                            }}
                                            onClick={() => router.push(`/release/${item.releaseId}`)}
                                            style={{ cursor: "pointer" }}
                                        >
                                            <div className="sonic-radar-card-art">
                                                {item.artworkUrl ? (
                                                    /* eslint-disable-next-line @next/next/no-img-element */
                                                    <img src={item.artworkUrl} alt={item.title} loading="lazy" />
                                                ) : (
                                                    <div className="sonic-radar-card-art-placeholder">
                                                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                                            <path d="M9 18V5l12-2v13" />
                                                            <circle cx="6" cy="18" r="3" />
                                                            <circle cx="18" cy="16" r="3" />
                                                        </svg>
                                                    </div>
                                                )}
                                                <div className="sonic-radar-card-overlay">
                                                    <div className="sonic-radar-play-icon">
                                                        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                                                            <polygon points="5 3 19 12 5 21 5 3" />
                                                        </svg>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="sonic-radar-card-info">
                                                <span className="sonic-radar-card-title">{item.title}</span>
                                                <span className="sonic-radar-card-artist">{item.artistName}</span>
                                                <div className="sonic-radar-stems">
                                                    {item.discovery && (
                                                        <span className="sonic-radar-stem-badge sonic-radar-stem-badge--confirmed">
                                                            New to you
                                                        </span>
                                                    )}
                                                    <span className="sonic-radar-stem-badge">{followUpLabel(item.followUp)}</span>
                                                    <span className="sonic-radar-stem-badge" title="Why this fits you">
                                                        {item.reason.text}
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="sonic-radar-card-footer">
                                                {item.nextAction ? (
                                                    <Link
                                                        href={item.nextAction.href}
                                                        className="sonic-radar-add-playlist-btn"
                                                        onClick={(e) => e.stopPropagation()}
                                                    >
                                                        {item.nextAction.label}
                                                    </Link>
                                                ) : (
                                                    <span />
                                                )}
                                                <button
                                                    className="sonic-radar-card-add-btn"
                                                    title="Add to playlist"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        void addToPlaylist([item]);
                                                    }}
                                                >
                                                    +
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        ))}
                    </div>
                )}
            </main>
        </AuthGate>
    );
}
