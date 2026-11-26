"use client";

import { useEffect, useState, useCallback } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "../auth/AuthProvider";
import { getAgentConfig, createAgentConfig } from "../../lib/api";
import AgentSetupWizard from "./AgentSetupWizard";
import { getAnalyticsConsentState, subscribeToAnalyticsConsent } from "../../lib/analyticsConsent";

const DISMISSED_KEY = "resonate.agent_onboarding_dismissed";

/**
 * Renders the AgentSetupWizard overlay automatically when a user
 * first connects their wallet and has no AgentConfig.
 * Placed in AppShell, but it only opens on Home, where the AI DJ lives: a
 * newcomer who follows a link to a release, a show or the upload page sees
 * that page, not a dialog about something else. Home's AI DJ section and
 * Settings → AI DJ also offer "Set up your DJ".
 *
 * It waits while the usage-measurement question is still on screen, so a new
 * account never gets the consent banner drawn over this dialog, and a
 * dismissal is remembered on this device rather than only for the tab.
 */
export default function AgentOnboardingGate() {
    const { status, token } = useAuth();
    const onHome = usePathname() === "/";
    const [showWizard, setShowWizard] = useState(false);
    const [checked, setChecked] = useState(() => {
        return wasDismissed();
    });
    const [consentPending, setConsentPending] = useState(() => isConsentPending(getAnalyticsConsentState()));

    useEffect(
        () => subscribeToAnalyticsConsent((state) => setConsentPending(isConsentPending(state))),
        [],
    );

    useEffect(() => {
        if (status !== "authenticated" || !token || checked) return;

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
        try {
            localStorage.setItem(DISMISSED_KEY, "1");
        } catch {
            // Storage blocked: the dialog may come back on the next visit.
        }
        setShowWizard(false);
    }, []);

    if (!showWizard || consentPending || !onHome) return null;

    return <AgentSetupWizard onComplete={handleComplete} onClose={handleClose} />;
}

function wasDismissed(): boolean {
    if (typeof window === "undefined") return false;
    try {
        return Boolean(localStorage.getItem(DISMISSED_KEY) || sessionStorage.getItem(DISMISSED_KEY));
    } catch {
        return false;
    }
}

/** The consent banner is showing, or about to: not yet known, or not answered. */
function isConsentPending(state: { known: boolean; needsDecision: boolean }): boolean {
    return !state.known || state.needsDecision;
}
