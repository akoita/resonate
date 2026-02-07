"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import AuthGate from "../../components/auth/AuthGate";
import { useAgentHistory } from "../../hooks/useAgentHistory";
import { useAuth } from "../../components/auth/AuthProvider";
import type { AgentSessionLicense } from "../../lib/api";

type GroupedSession = {
    date: string;
    sessionId: string;
    licenses: AgentSessionLicense[];
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

    // Flatten sessions into grouped display
    const groups: GroupedSession[] = sessions
        .filter((s) => s.licenses.length > 0)
        .map((s) => ({
            date: formatSessionDate(s.startedAt),
            sessionId: s.id,
            licenses: s.licenses,
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
                                    <span className="sonic-radar-group-count">
                                        {group.licenses.length} track{group.licenses.length !== 1 ? "s" : ""}
                                    </span>
                                </div>
                                <div className="sonic-radar-grid">
                                    {group.licenses.map((lic) => (
                                        <Link
                                            key={lic.id}
                                            href={`/release/${lic.track.releaseId}`}
                                            className="sonic-radar-card"
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
                                            </div>
                                            <div className="sonic-radar-card-footer">
                                                <span className="sonic-radar-card-license">{licenseLabel(lic.type)}</span>
                                                <span className="sonic-radar-card-price">${lic.priceUsd.toFixed(2)}</span>
                                            </div>
                                        </Link>
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
