"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../components/auth/AuthProvider";
import {
    getAgentConfig,
    createAgentConfig,
    updateAgentConfig,
    mintAgentIdentity,
    attestAgentReputation,
    startAgentSession,
    stopAgentSession,
    type AgentConfig,
    type AgentNextPreferences,
} from "../lib/api";

export function useAgentConfig() {
    const { status, token } = useAuth();
    const [config, setConfig] = useState<AgentConfig | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [showWizard, setShowWizard] = useState(false);

    const fetchConfig = useCallback(async () => {
        if (status !== "authenticated" || !token) return;
        setIsLoading(true);
        try {
            const result = await getAgentConfig(token);
            setConfig(result);
            setShowWizard(!result);
        } catch {
            setShowWizard(true);
        } finally {
            setIsLoading(false);
        }
    }, [status, token]);

    useEffect(() => {
        fetchConfig();
    }, [fetchConfig]);

    const createConfig = useCallback(
        async (input: { name: string; vibes: string[]; monthlyCapUsd: number }) => {
            if (!token) return;
            const result = await createAgentConfig(token, input);
            setConfig(result);
            setShowWizard(false);
            return result;
        },
        [token]
    );

    const patchConfig = useCallback(
        async (input: { name?: string; vibes?: string[]; stemTypes?: string[]; sessionMode?: "curate" | "buy"; monthlyCapUsd?: number; isActive?: boolean }) => {
            if (!token) return;
            const result = await updateAgentConfig(token, input);
            setConfig(result);
            return result;
        },
        [token]
    );

    const startSession = useCallback(async (input?: { preferences?: AgentNextPreferences }) => {
        if (!config || !token) return;
        const result = await startAgentSession(token, input);
        if (result.status === "started") {
            setConfig((prev) => prev ? { ...prev, isActive: true } : prev);
        }
        return result;
    }, [config, token]);

    const mintIdentity = useCallback(async () => {
        if (!token) return;
        const result = await mintAgentIdentity(token);
        setConfig(result);
        return result;
    }, [token]);

    const attestReputation = useCallback(async () => {
        if (!token) return;
        const result = await attestAgentReputation(token);
        setConfig(result);
        return result;
    }, [token]);

    const stopSession = useCallback(async () => {
        if (!config || !token) return;
        const result = await stopAgentSession(token);
        if (result.status === "stopped") {
            setConfig((prev) => prev ? { ...prev, isActive: false } : prev);
        }
        return result;
    }, [config, token]);

    return {
        config,
        isLoading,
        showWizard,
        setShowWizard,
        createConfig,
        updateConfig: patchConfig,
        mintIdentity,
        attestReputation,
        startSession,
        stopSession,
        refetch: fetchConfig,
    };
}
