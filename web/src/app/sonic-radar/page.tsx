"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import AuthGate from "../../components/auth/AuthGate";
import { useAgentHistory } from "../../hooks/useAgentHistory";
import { useAuth } from "../../components/auth/AuthProvider";
import { useUIStore } from "../../lib/uiStore";
import { type LocalTrack, saveTracksMetadata } from "../../lib/localLibrary";
import type { AgentSessionLicense, AgentTransaction } from "../../lib/api";
import { getReleaseArtworkUrl } from "../../lib/api";

type GroupedSession = {
    date: string;
    sessionId: string;
    licenses: AgentSessionLicense[];
    transactions: AgentTransaction[];
};

function formatSessionDate(iso: string) {
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const days = Math.floor(diff / 86400000);

    if (days === 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days < 7) return `${days} days ago`;
    return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function licenseLabel(type: string) {
    switch (type) {
        case "personal": return "Personal";
        case "remix": return "Remix";
        case "commercial": return "Commercial";
        default: return type;
    }
}

export default function SonicRadarPage() {
    const { sessions, isLoading } = useAgentHistory();
    const { status } = useAuth();
    const router = useRouter();
    const { setTracksToAddToPlaylist } = useUIStore();

    /**
     * Build individual stem-level LocalTrack entries from a session group.
     * Each confirmed transaction (Drums, Vocals, etc.) becomes a separate
     * playlist entry with a deterministic ID so it's both unique and resolvable.
     * Saves them to the library before returning so getTrack() can resolve later.
     */
    const buildStemTracks = async (group: GroupedSession): Promise<LocalTrack[]> => {
        const confirmedTxs = group.transactions.filter(t => t.status === 'confirmed' && t.trackId);

        if (confirmedTxs.length === 0) {
            // Fallback: no transactions, use licenses (one per parent track)
            const seen = new Set<string>();
            return group.licenses
                .filter(lic => {
                    if (seen.has(lic.trackId)) return false;
                    seen.add(lic.trackId);
                    return true;
                })
                .map(lic => ({
                    id: lic.trackId,
                    title: lic.track.title,
                    artist: lic.track.artist,
                    albumArtist: null,
                    album: lic.track.release?.title || null,
                    year: null,
                    genre: null,
                    duration: null,
                    createdAt: new Date().toISOString(),
                    source: "remote" as const,
                    remoteArtworkUrl: lic.track.release?.artworkUrl || undefined,
                }));
        }

        // Build a lookup from trackId → license (for artwork)
        const licByTrack = new Map(group.licenses.map(l => [l.trackId, l]));

        // Create one LocalTrack per stem transaction
        const stemTracks: LocalTrack[] = confirmedTxs.map(tx => {
            const stemSlug = tx.stemName?.toLowerCase().replace(/\s+/g, '_') || 'unknown';
            const lic = licByTrack.get(tx.trackId!);
            const artworkUrl = lic?.track.release?.artworkUrl
                || (lic?.track.release?.artworkMimeType ? getReleaseArtworkUrl(lic.track.release.id) : undefined);

            return {
                id: `stem_${tx.trackId}_${stemSlug}`,
                title: tx.stemName ? `${tx.trackTitle || 'Unknown'} (${tx.stemName})` : (tx.trackTitle || 'Unknown'),
                artist: tx.trackArtist || null,
                albumArtist: null,
                album: lic?.track.release?.title || null,
                year: null,
                genre: null,
                duration: null,
                createdAt: tx.createdAt,
                source: "remote" as const,
                stemType: tx.stemName || undefined,
                remoteArtworkUrl: artworkUrl,
            };
        });

        // Persist to library so PlaylistDetail.getTrack() can resolve them
        try {
            await saveTracksMetadata(stemTracks, "remote");
        } catch (err) {
            console.warn('[SonicRadar] Failed to save stem tracks to library:', err);
        }

        return stemTracks;
    };

    // Flatten sessions into grouped display
    const groups: GroupedSession[] = sessions
        .filter((s) => s.licenses.length > 0)
        .map((s) => ({
            date: formatSessionDate(s.startedAt),
            sessionId: s.id,
            licenses: s.licenses,
            transactions: s.agentTransactions || [],
        }));

    // Total unique tracks
    const allLicenses = groups.flatMap((g) => g.licenses);
    const uniqueTracks = new Set(allLicenses.map((l) => l.trackId)).size;

    return (
        <AuthGate title="Connect your wallet to see your AI-curated discoveries.">
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
                            Your AI-curated discoveries — every track your DJ found, negotiated, and secured for you.
                        </p>
                        {!isLoading && allLicenses.length > 0 && (
                            <div className="sonic-radar-stats">
                                <div className="sonic-radar-stat">
                                    <span className="sonic-radar-stat-value">{uniqueTracks}</span>
                                    <span className="sonic-radar-stat-label">Track{uniqueTracks !== 1 ? "s" : ""} Discovered</span>
                                </div>
                                <div className="sonic-radar-stat-divider" />
                                <div className="sonic-radar-stat">
                                    <span className="sonic-radar-stat-value">{groups.length}</span>
                                    <span className="sonic-radar-stat-label">Session{groups.length !== 1 ? "s" : ""}</span>
                                </div>
                                <div className="sonic-radar-stat-divider" />
                                <div className="sonic-radar-stat">
                                    <span className="sonic-radar-stat-value">
                                        ${allLicenses.reduce((s, l) => s + l.priceUsd, 0).toFixed(2)}
                                    </span>
                                    <span className="sonic-radar-stat-label">Total Spent</span>
                                </div>
                            </div>
                        )}
                    </div>
                </section>

                {/* Content */}
                {isLoading ? (
                    <section className="sonic-radar-loading">
                        <div className="sonic-radar-shimmer-grid">
                            {Array.from({ length: 8 }).map((_, i) => (
                                <div key={i} className="sonic-radar-shimmer-card" />
                            ))}
                        </div>
                    </section>
                ) : groups.length === 0 ? (
                    <section className="sonic-radar-empty">
                        <div className="sonic-radar-empty-icon">📡</div>
                        <h2>No discoveries yet</h2>
                        <p>
                            Your Sonic Radar is quiet. Set up your AI DJ and start a session
                            to discover tracks tailored to your taste.
                        </p>
                        <Link href="/agent" className="ui-btn ui-btn-primary">
                            Launch AI DJ
                        </Link>
                    </section>
                ) : (
                    <div className="sonic-radar-feed">
                        {groups.map((group) => (
                            <section key={group.sessionId} className="sonic-radar-group">
                                <div className="sonic-radar-group-header">
                                    <span className="sonic-radar-group-date">{group.date}</span>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                        <button
                                            className="sonic-radar-add-playlist-btn"
                                            title="Add all session tracks to playlist"
                                            onClick={async () => {
                                                const tracks = await buildStemTracks(group);
                                                setTracksToAddToPlaylist(tracks);
                                            }}
                                        >
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M11 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-5" />
                                                <path d="M18 2h4v4" />
                                                <path d="M15 9l7-7" />
                                            </svg>
                                            Add to Playlist
                                        </button>
                                        <span className="sonic-radar-group-count">
                                            {group.licenses.length} track{group.licenses.length !== 1 ? "s" : ""}
                                        </span>
                                    </div>
                                </div>
                                <div className="sonic-radar-grid">
                                    {group.licenses.map((lic) => {
                                        const storedTx = group.transactions.filter(t => t.trackId === lic.track.id && t.status === 'confirmed');
                                        const purchasedStems = storedTx.map(t => t.stemName).filter(Boolean);

                                        return (
                                            <div
                                                key={lic.id}
                                                className="sonic-radar-card"
                                                draggable
                                                onDragStart={(e) => {
                                                    const payload = JSON.stringify({
                                                        type: "track",
                                                        id: lic.trackId,
                                                        title: lic.track.title,
                                                        artist: lic.track.artist || "Unknown Artist",
                                                    });
                                                    e.dataTransfer.setData("application/json", payload);
                                                    e.dataTransfer.setData("text/plain", payload);
                                                    e.dataTransfer.effectAllowed = "copy";
                                                }}
                                                onClick={() => router.push(`/release/${lic.track.releaseId}`)}
                                                style={{ cursor: 'pointer' }}
                                            >
                                                <div className="sonic-radar-card-art">
                                                    {lic.track.release?.artworkUrl ? (
                                                        <img
                                                            src={lic.track.release.artworkUrl}
                                                            alt={lic.track.title}
                                                            loading="lazy"
                                                        />
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
                                                    <span className="sonic-radar-card-title">{lic.track.title}</span>
                                                    <span className="sonic-radar-card-artist">
                                                        {lic.track.artist || lic.track.release?.title || "Unknown Artist"}
                                                    </span>
                                                    {purchasedStems.length > 0 && (
                                                        <div className="sonic-radar-stems">
                                                            {purchasedStems.map((stem, i) => (
                                                                <span key={i} className="sonic-radar-stem-badge">
                                                                    {stem}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="sonic-radar-card-footer">
                                                    <span className="sonic-radar-card-license">{licenseLabel(lic.type)}</span>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        <button
                                                            className="sonic-radar-card-add-btn"
                                                            title="Add to playlist"
                                                            onClick={async (e) => {
                                                                e.stopPropagation();
                                                                // Build stem tracks for just this license's track
                                                                const txsForTrack = group.transactions.filter(
                                                                    t => t.trackId === lic.trackId && t.status === 'confirmed'
                                                                );
                                                                if (txsForTrack.length > 0) {
                                                                    // Create a mini-group for this one track
                                                                    const miniGroup: GroupedSession = {
                                                                        ...group,
                                                                        transactions: txsForTrack,
                                                                        licenses: [lic],
                                                                    };
                                                                    const tracks = await buildStemTracks(miniGroup);
                                                                    setTracksToAddToPlaylist(tracks);
                                                                } else {
                                                                    // Fallback: add parent track
                                                                    setTracksToAddToPlaylist([{
                                                                        id: lic.trackId,
                                                                        title: lic.track.title,
                                                                        artist: lic.track.artist,
                                                                        albumArtist: null,
                                                                        album: lic.track.release?.title || null,
                                                                        year: null,
                                                                        genre: null,
                                                                        duration: null,
                                                                        createdAt: new Date().toISOString(),
                                                                        source: "remote" as const,
                                                                        remoteArtworkUrl: lic.track.release?.artworkUrl || undefined,
                                                                    }]);
                                                                }
                                                            }}
                                                        >
                                                            +
                                                        </button>
                                                        <span className="sonic-radar-card-price">${lic.priceUsd.toFixed(2)}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </section>
                        ))}
                    </div>
                )}
            </main>
        </AuthGate>
    );
}
