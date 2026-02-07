"use client";

import type { AgentEvent } from "../../hooks/useAgentEvents";

const PLACEHOLDER_EVENTS: AgentEvent[] = [
    { id: "p1", type: "info", sessionId: "", message: "Ready to start curating", timestamp: "", icon: "🎯" },
    { id: "p2", type: "info", sessionId: "", message: "Configure your preferences and hit Start Session", timestamp: "", icon: "💡" },
];

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
        <div className="agent-card agent-activity-card">
            <h3 className="agent-card-title">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                </svg>
                Activity Feed
                {isActive && <span className="agent-live-badge">LIVE</span>}
            </h3>
            <div className="agent-activity-list">
                {displayEvents.slice(0, 8).map((event) => (
                    <div key={event.id} className="agent-activity-item">
                        <span className="agent-activity-icon">{event.icon}</span>
                        <div className="agent-activity-content">
                            <span className="agent-activity-action">{event.message}</span>
                            {event.timestamp && (
                                <span className="agent-activity-time">{formatTime(event.timestamp)}</span>
                            )}
                        </div>
                    </div>
                ))}
            </div>
            {!isActive && events.length === 0 && (
                <div className="agent-activity-empty">
                    Your DJ hasn&apos;t started yet. Hit <strong>Start Session</strong>!
                </div>
            )}
        </div>
    );
}
