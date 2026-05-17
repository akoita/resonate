"use client";

import type { AgentEvent } from "../../hooks/useAgentEvents";

const PLACEHOLDER_EVENTS: AgentEvent[] = [
    { id: "p1", type: "info", sessionId: "", message: "Ready to start curating", timestamp: "", icon: "🎯" },
    { id: "p2", type: "info", sessionId: "", message: "Configure your preferences and hit Start Session", timestamp: "", icon: "💡" },
];

const EVENT_TYPE_CLASS: Record<string, string> = {
    success: "event--success",
    error: "event--error",
    warning: "event--warning",
    info: "event--info",
};

type Props = {
    isActive: boolean;
    events: AgentEvent[];
};

function formatTime(ts: string) {
    if (!ts) return "";
    const diff = Date.now() - new Date(ts).getTime();
    if (diff < 5000) return "Just now";
    if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    return `${Math.floor(diff / 3600000)}h ago`;
}

export default function AgentActivityFeed({ isActive, events }: Props) {
    const displayEvents = events.length > 0 ? events : PLACEHOLDER_EVENTS;

    return (
        <div className="aid-card aid-card--activity">
            <div className="aid-card-header">
                <div className="aid-card-title-row">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                    </svg>
                    <span className="aid-card-title">Live Feed</span>
                </div>
                {isActive && <span className="aid-live-badge">LIVE</span>}
            </div>

            <div className="aid-feed-list">
                {displayEvents.slice(0, 10).map((event) => (
                    <div key={event.id} className={`aid-feed-item ${EVENT_TYPE_CLASS[event.type] ?? "event--info"}`}>
                        <span className="aid-feed-icon">{event.icon}</span>
                        <div className="aid-feed-content">
                            <span className="aid-feed-msg">{event.message}</span>
                            {event.timestamp && (
                                <span className="aid-feed-time">{formatTime(event.timestamp)}</span>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {!isActive && events.length === 0 && (
                <div className="aid-feed-empty">
                    Your DJ hasn&apos;t started yet. Hit <strong>Start Session</strong> above!
                </div>
            )}
        </div>
    );
}
