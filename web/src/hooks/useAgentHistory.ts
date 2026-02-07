"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "../components/auth/AuthProvider";
import { getAgentHistory, type AgentSession } from "../lib/api";

export function useAgentHistory() {
    const { status, token } = useAuth();
    const [sessions, setSessions] = useState<AgentSession[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const fetchHistory = useCallback(async () => {
        if (status !== "authenticated" || !token) return;
        setIsLoading(true);
        try {
            const result = await getAgentHistory(token);
            setSessions(result);
        } catch {
            // Silently fail — history is non-critical
        } finally {
            setIsLoading(false);
        }
    }, [status, token]);

    useEffect(() => {
        fetchHistory();
    }, [fetchHistory]);

    return { sessions, isLoading, refetch: fetchHistory };
}
