"use client";

import Link from "next/link";
import type { AgentSession } from "../../lib/api";

type Props = {
    sessions: AgentSession[];
    isLoading: boolean;
};

function formatDate(iso: string) {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatDuration(startedAt: string, endedAt: string | null) {
    if (!endedAt) return "In progress";
    const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
    const mins = Math.floor(ms / 60000);
    if (mins < 1) return "<1m";
    if (mins < 60) return `${mins}m`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function licenseIcon(type: string) {
    switch (type) {
        case "personal": return "🎧";
        case "remix": return "🎛️";
        case "commercial": return "💼";
        default: return "📄";
    }
}

export default function AgentHistoryCard({ sessions, isLoading }: Props) {
    if (isLoading) {
        return (
            <div className="agent-card agent-history-card">
                <h3 className="agent-card-title">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                    </svg>
                    Session History
                </h3>
                <div className="agent-history-loading">
                    <div className="agent-history-skeleton" />
                    <div className="agent-history-skeleton" />
                </div>
            </div>
        );
    }

    return (
        <div className="agent-card agent-history-card">
            <h3 className="agent-card-title">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                </svg>
                Session History
                {sessions.length > 0 && (
                    <span className="agent-history-count">{sessions.length}</span>
                )}
            </h3>

            {sessions.length === 0 ? (
                <div className="agent-history-empty">
                    <div className="agent-history-empty-icon">🎵</div>
                    <p>No sessions yet. Start your DJ to begin!</p>
                </div>
            ) : (
                <div className="agent-history-list">
                    {sessions.map((session) => (
                        <details key={session.id} className="agent-history-item">
                            <summary className="agent-history-summary">
                                <div className="agent-history-indicator">
                                    {!session.endedAt ? (
                                        <span className="agent-history-pulse" />
                                    ) : (
                                        <span className="agent-history-dot" />
                                    )}
                                </div>
                                <div className="agent-history-info">
                                    <span className="agent-history-date">{formatDate(session.startedAt)}</span>
                                    <span className="agent-history-duration">{formatDuration(session.startedAt, session.endedAt)}</span>
                                </div>
                                <div className="agent-history-stats">
                                    <span className="agent-history-tracks">
                                        {session.licenses.length} track{session.licenses.length !== 1 ? "s" : ""}
                                    </span>
                                    <span className="agent-history-spend">${session.spentUsd.toFixed(2)}</span>
                                </div>
                                {!session.endedAt && <span className="agent-live-badge">LIVE</span>}
                                <svg className="agent-history-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <polyline points="6 9 12 15 18 9" />
                                </svg>
                            </summary>
                            {session.licenses.length > 0 && (
                                <div className="agent-history-details">
                                    {session.licenses.map((lic) => (
                                        <Link
                                            key={lic.id}
                                            href={`/release/${lic.track.releaseId}`}
                                            className="agent-history-license"
                                        >
                                            <div className="agent-history-license-art">
                                                {lic.track.release?.artworkUrl ? (
                                                    <img
                                                        src={lic.track.release.artworkUrl}
                                                        alt=""
                                                        width={40}
                                                        height={40}
                                                    />
                                                ) : (
                                                    <div className="agent-history-license-art-placeholder">♫</div>
                                                )}
                                            </div>
                                            <div className="agent-history-license-info">
                                                <span className="agent-history-license-track">{lic.track.title}</span>
                                                <span className="agent-history-license-artist">
                                                    {lic.track.artist || lic.track.release?.title || "Unknown Artist"}
                                                </span>
                                            </div>
                                            <div className="agent-history-license-meta">
                                                <span className="agent-history-license-type-badge">
                                                    {licenseIcon(lic.type)} {lic.type}
                                                </span>
                                                <span className="agent-history-license-price">${lic.priceUsd.toFixed(2)}</span>
                                            </div>
                                            <svg className="agent-history-license-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                <polyline points="9 18 15 12 9 6" />
                                            </svg>
                                        </Link>
                                    ))}
                                </div>
                            )}
                        </details>
                    ))}
                </div>
            )}
        </div>
    );
}
