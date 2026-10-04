"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "../components/auth/AuthProvider";
import { getAgentHistory, getAgentHistorySummary, type AgentHistorySummary, type AgentSession } from "../lib/api";

export function useAgentHistory() {
    const { status, token } = useAuth();
    const [sessions, setSessions] = useState<AgentSession[]>([]);
    const [summary, setSummary] = useState<AgentHistorySummary | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    const fetchHistory = useCallback(async () => {
        if (status !== "authenticated" || !token) return;
        setIsLoading(true);
        try {
            // History is non-critical: a failed request keeps its previous value.
            const [result, totals] = await Promise.allSettled([
                getAgentHistory(token),
                getAgentHistorySummary(token),
            ]);
            if (result.status === "fulfilled") setSessions(result.value);
            if (totals.status === "fulfilled") setSummary(totals.value);
        } finally {
            setIsLoading(false);
        }
    }, [status, token]);

    useEffect(() => {
        fetchHistory();
    }, [fetchHistory]);

    return { sessions, summary, isLoading, refetch: fetchHistory };
}
