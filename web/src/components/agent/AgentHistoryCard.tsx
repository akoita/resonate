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
        case "personal": return "\u{1F3A7}";
        case "remix": return "\u{1F39B}\uFE0F";
        case "commercial": return "\u{1F4BC}";
        default: return "\u{1F4C4}";
    }
}

function recommendationText(recommendation: AgentSession["licenses"][number]["recommendation"]) {
    const summary = recommendation?.recommendation;
    if (summary?.explanation?.length) {
        return summary.explanation.slice(0, 2).join(" \u00B7 ");
    }
    if (recommendation?.reason) {
        return recommendation.reason.replace(/_/g, " ");
    }
    if (recommendation?.runtime === "llm") {
        return "LLM-curated pick";
    }
    return "Curated within session policy";
}

export default function AgentHistoryCard({ sessions, isLoading }: Props) {
    if (isLoading) {
        return (
            <div className="aid-card aid-card--history">
                <div className="aid-card-header">
                    <div className="aid-card-title-row">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" />
                            <polyline points="12 6 12 12 16 14" />
                        </svg>
                        <span className="aid-card-title">Session History</span>
                    </div>
                </div>
                <div className="aid-history-loading" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div className="aid-skeleton" style={{ height: 56 }} />
                    <div className="aid-skeleton" style={{ height: 56 }} />
                </div>
            </div>
        );
    }

    return (
        <div className="aid-card aid-card--history">
            <div className="aid-card-header">
                <div className="aid-card-title-row">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                    </svg>
                    <span className="aid-card-title">Session History</span>
                </div>
                {sessions.length > 0 && (
                    <span className="aid-count-badge">{sessions.length}</span>
                )}
            </div>

            {sessions.length === 0 ? (
                <div className="aid-history-empty">
                    <div className="aid-history-empty-icon">{"\u{1F3B5}"}</div>
                    <p>No sessions yet. Start your DJ to begin!</p>
                </div>
            ) : (
                <div className="aid-history-list">
                    {sessions.map((session) => (
                        <details key={session.id} className="aid-history-item">
                            <summary className="aid-history-summary">
                                <div className="aid-history-indicator">
                                    {!session.endedAt ? (
                                        <span className="aid-pulse-dot" />
                                    ) : (
                                        <span className="aid-dot" />
                                    )}
                                </div>
                                <div className="aid-history-info">
                                    <span className="aid-history-date">{formatDate(session.startedAt)}</span>
                                    <span className="aid-history-duration">{formatDuration(session.startedAt, session.endedAt)}</span>
                                </div>
                                <div className="aid-history-stats">
                                    <span className="aid-history-tracks">
                                        {session.licenses.length} track{session.licenses.length !== 1 ? "s" : ""}
                                    </span>
                                    <span className="aid-history-spend">${session.spentUsd.toFixed(2)}</span>
                                </div>
                                {!session.endedAt && <span className="aid-live-badge">LIVE</span>}
                                <svg className="aid-history-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <polyline points="6 9 12 15 18 9" />
                                </svg>
                            </summary>
                            {session.licenses.length > 0 && (
                                <div className="aid-history-details">
                                    {session.licenses.map((lic) => (
                                        <Link
                                            key={lic.id}
                                            href={`/release/${lic.track.releaseId}`}
                                            className="aid-history-license"
                                        >
                                            <div className="aid-history-lic-art">
                                                {lic.track.release?.artworkUrl ? (
                                                    /* eslint-disable-next-line @next/next/no-img-element */
                                                    <img
                                                        src={lic.track.release.artworkUrl}
                                                        alt=""
                                                        width={40}
                                                        height={40}
                                                    />
                                                ) : (
                                                    <div className="aid-history-lic-art-ph">{"\u266B"}</div>
                                                )}
                                            </div>
                                            <div className="aid-history-lic-info">
                                                <span className="aid-history-lic-track">{lic.track.title}</span>
                                                <span className="aid-history-lic-artist">
                                                    {lic.track.artist || lic.track.release?.title || "Unknown Artist"}
                                                </span>
                                                <span className="aid-taste-hint">
                                                    {recommendationText(lic.recommendation)}
                                                </span>
                                            </div>
                                            <div className="aid-history-lic-meta">
                                                <span className="aid-lic-badge">
                                                    {licenseIcon(lic.type)} {lic.type}
                                                </span>
                                                {typeof lic.recommendation?.recommendation?.score === "number" && (
                                                    <span className="aid-lic-badge">
                                                        score {lic.recommendation.recommendation.score}
                                                    </span>
                                                )}
                                                <span className="aid-history-lic-price">${lic.priceUsd.toFixed(2)}</span>
                                            </div>
                                            <svg className="aid-history-lic-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
