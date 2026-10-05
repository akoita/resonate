"use client";

import Link from "next/link";
import type { AgentSession, AgentSessionFilters } from "../../lib/api";

type Props = {
    /** Most recent sessions, capped by the backend history limit. */
    sessions: AgentSession[];
    /** Lifetime session count; may exceed `sessions.length`. */
    totalCount: number;
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

function describeTempo(tempo: NonNullable<AgentSessionFilters["tempoBpm"]>) {
    const { min, max } = tempo;
    if (min !== null && max !== null) return min === max ? `${min} BPM` : `${min}\u2013${max} BPM`;
    if (min !== null) return `from ${min} BPM`;
    if (max !== null) return `up to ${max} BPM`;
    return null;
}

/** The one-line summary of a session's own filters; null for sessions that predate them. */
export function describeSessionFilters(
    filters: AgentSessionFilters | null | undefined,
): { preset: string | null; rest: string[]; text: string } | null {
    if (!filters) return null;
    const preset = filters.presetName?.trim() || null;
    const rest: string[] = [];
    if (filters.genres?.length) rest.push(filters.genres.join(" \u00B7 "));
    if (filters.moods?.length) rest.push(filters.moods.join(" \u00B7 "));
    if (filters.energy) rest.push(`Energy ${filters.energy}`);
    const tempo = filters.tempoBpm ? describeTempo(filters.tempoBpm) : null;
    if (tempo) rest.push(tempo);
    if (filters.myMix) rest.push("My Mix");
    if (!preset && rest.length === 0) rest.push("Saved taste");
    if (filters.explicit) rest.push("Explicit on");
    const text = [...(preset ? [preset] : []), ...rest].join(" \u00B7 ");
    return { preset, rest, text };
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

function SessionFiltersLine({ filters }: { filters: AgentSession["filters"] }) {
    const summary = describeSessionFilters(filters);
    if (!summary) return null;
    return (
        <span className="aid-history-filters" title={summary.text}>
            {summary.preset && <strong className="aid-history-filters-preset">{summary.preset}</strong>}
            {summary.preset && summary.rest.length > 0 ? " \u00B7 " : ""}
            {summary.rest.join(" \u00B7 ")}
        </span>
    );
}

export default function AgentHistoryCard({ sessions, totalCount, isLoading }: Props) {
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
                {totalCount > 0 && (
                    <span className="aid-count-badge">{totalCount}</span>
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
                                    <SessionFiltersLine filters={session.filters} />
                                </div>
                                <div className="aid-history-stats">
                                    <span className="aid-history-tracks">
                                        {session.licenses.length} track{session.licenses.length !== 1 ? "s" : ""}
                                    </span>
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
                                                {typeof lic.recommendation?.recommendation?.score === "number" && (
                                                    <span className="aid-lic-badge">
                                                        score {lic.recommendation.recommendation.score}
                                                    </span>
                                                )}
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
                    {totalCount > sessions.length && (
                        <p className="aid-history-window-note">
                            Showing your {sessions.length} most recent of {totalCount} sessions.
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}
