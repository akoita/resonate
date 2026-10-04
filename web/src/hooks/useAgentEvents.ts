"use client";

import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { API_BASE, type AgentRequestCoverage } from "../lib/api";
import { useAuth } from "../components/auth/AuthProvider";

export interface AgentEvent {
    id: string;
    type: string;
    sessionId: string;
    message: string;
    timestamp: string;
    icon: string;
    detail?: string;
    /** #2037: how well a decision's picks matched the session request (agent.decision_made). */
    coverage?: AgentRequestCoverage;
}

const EVENT_ICONS: Record<string, string> = {
    "session.started": "🚀",
    "session.ended": "⏹️",
    "agent.selection": "🔍",
    "agent.mix_planned": "🎧",
    "agent.negotiated": "💰",
    "agent.decision_made": "✅",
};

const MAX_EVENTS = 50;
const NO_EVENTS: AgentEvent[] = [];

export function useAgentEvents() {
    const { token } = useAuth();
    // Events are stamped with the token they arrived under, so a different
    // account never sees the previous account's feed after a token change.
    const [feed, setFeed] = useState<{ token: string | null; events: AgentEvent[] }>({
        token: null,
        events: NO_EVENTS,
    });
    const socketRef = useRef<Socket | null>(null);

    useEffect(() => {
        // Agent events are delivered only to the session owner's room, so the
        // socket has to authenticate; without a token there is nothing to receive.
        if (!token) return;

        const socket = io(API_BASE, {
            transports: ["websocket", "polling"],
            auth: { token },
            reconnectionAttempts: 10,
            reconnectionDelay: 1000,
        });

        socketRef.current = socket;

        socket.on("agent.event", (data: AgentEvent) => {
            setFeed((prev) => {
                const earlier = prev.token === token ? prev.events : NO_EVENTS;
                const next = [
                    { ...data, icon: EVENT_ICONS[data.type] ?? "📋" },
                    ...earlier,
                ];
                return { token, events: next.slice(0, MAX_EVENTS) };
            });
        });

        return () => {
            socket.disconnect();
            socketRef.current = null;
        };
    }, [token]);

    return feed.token === token ? feed.events : NO_EVENTS;
}
