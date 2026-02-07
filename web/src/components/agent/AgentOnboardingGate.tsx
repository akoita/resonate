"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "../auth/AuthProvider";
import { getAgentConfig, createAgentConfig } from "../../lib/api";
import AgentSetupWizard from "./AgentSetupWizard";

const DISMISSED_KEY = "resonate.agent_onboarding_dismissed";

/**
 * Renders the AgentSetupWizard overlay automatically when a user
 * first connects their wallet and has no AgentConfig.
 * Placed in AppShell so it works on every page, not just /agent.
 */
export default function AgentOnboardingGate() {
    const { status, token } = useAuth();
    const [showWizard, setShowWizard] = useState(false);
    const [checked, setChecked] = useState(false);

    useEffect(() => {
        if (status !== "authenticated" || !token || checked) return;

        // Don't show if user already dismissed this session
        if (sessionStorage.getItem(DISMISSED_KEY)) {
            setChecked(true);
            return;
        }

        let cancelled = false;
        getAgentConfig(token)
            .then((config) => {
                if (cancelled) return;
                setChecked(true);
                if (!config) {
                    setShowWizard(true);
                }
            })
            .catch(() => {
                if (!cancelled) setChecked(true);
            });

        return () => { cancelled = true; };
    }, [status, token, checked]);

    const handleComplete = useCallback(
        async (data: { name: string; vibes: string[]; monthlyCapUsd: number }) => {
            if (!token) return;
            await createAgentConfig(token, data);
            setShowWizard(false);
        },
        [token]
    );

    const handleClose = useCallback(() => {
        sessionStorage.setItem(DISMISSED_KEY, "1");
        setShowWizard(false);
    }, []);

    if (!showWizard) return null;

    return <AgentSetupWizard onComplete={handleComplete} onClose={handleClose} />;
}
