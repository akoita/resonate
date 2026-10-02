"use client";

import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import type { AgentRequestCoverage } from "../lib/api";

const SOCKET_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

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

export function useAgentEvents() {
    const [events, setEvents] = useState<AgentEvent[]>([]);
    const socketRef = useRef<Socket | null>(null);

    useEffect(() => {
        const socket = io(SOCKET_URL, {
            transports: ["websocket", "polling"],
            reconnectionAttempts: 10,
            reconnectionDelay: 1000,
        });

        socketRef.current = socket;

        socket.on("connect", () => {
            console.log(`[AgentEvents] Connected: ${socket.id}`);
        });

        socket.on("agent.event", (data: AgentEvent) => {
            console.log("[AgentEvents] Received:", data);
            setEvents((prev) => {
                const next = [
                    { ...data, icon: EVENT_ICONS[data.type] ?? "📋" },
                    ...prev,
                ];
                return next.slice(0, MAX_EVENTS);
            });
        });

        socket.on("disconnect", (reason) => {
            console.log(`[AgentEvents] Disconnected: ${reason}`);
        });

        return () => {
            socket.disconnect();
            socketRef.current = null;
        };
    }, []);

    return events;
}
