"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { getArtistMe } from "../../lib/api";
import { Button } from "../ui/Button";

interface ArtistGateProps {
    children: React.ReactNode;
}

type ArtistGateState = "checking" | "ready" | "missing" | "unavailable";

export default function ArtistGate({ children }: ArtistGateProps) {
    const { token, status, disconnect } = useAuth();
    const [gateState, setGateState] = useState<ArtistGateState>("checking");
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [retryTick, setRetryTick] = useState(0);
    const router = useRouter();

    const navigateToOnboarding = useCallback(() => {
        const targetPath = "/artist/onboarding?returnUrl=%2Fartist%2Fupload";

        if (typeof window !== "undefined") {
            router.push(targetPath);

            window.setTimeout(() => {
                const isHttpPage = window.location.protocol === "http:" || window.location.protocol === "https:";
                const isAlreadyOnOnboarding = window.location.pathname === "/artist/onboarding";

                if (!isAlreadyOnOnboarding && isHttpPage) {
                    window.location.href = new URL(targetPath, window.location.origin).toString();
                }
            }, 150);
            return;
        }

        router.push(targetPath);
    }, [router]);

    useEffect(() => {
        let cancelled = false;

        async function checkArtist() {
            if (token && status === "authenticated") {
                try {
                    const artist = await getArtistMe(token);
                    if (cancelled) return;
                    setErrorMessage(null);
                    setGateState(artist ? "ready" : "missing");
                } catch (error) {
                    console.error("Failed to check artist status:", error);
                    if (cancelled) return;

                    const message = error instanceof Error ? error.message : "Unable to verify artist profile.";
                    setErrorMessage(message);

                    if (message.includes("API 401")) {
                        setGateState("unavailable");
                        return;
                    }

                    setGateState("unavailable");
                }
                return;
            }

            if (status === "idle") {
                setErrorMessage(null);
                setGateState("checking");
                return;
            }

            if (status === "error") {
                setErrorMessage("Authentication is unavailable right now.");
                setGateState("unavailable");
            }
        }

        checkArtist();

        return () => {
            cancelled = true;
        };
    }, [token, status, retryTick]);

    if (gateState === "checking") {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        );
    }

    if (gateState === "unavailable") {
        return (
            <div className="gate-container">
                <div className="gate-glass-card">
                    <div className="gate-icon-wrapper">
                        <div className="gate-icon">
                            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"></path>
                                <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                            </svg>
                        </div>
                    </div>
                    <h2 className="gate-title">Couldn&apos;t verify your artist profile</h2>
                    <p className="gate-description">
                        {errorMessage?.includes("API 401")
                            ? "Your session expired while checking your artist account. Sign in again, then retry."
                            : "The app lost contact with the backend while checking your artist account. Retry once the dev servers have settled."}
                    </p>
                    <div className="gate-actions">
                        <Button
                            onClick={() => setRetryTick((tick) => tick + 1)}
                            variant="primary"
                            className="gate-submit-btn"
                        >
                            <span className="btn-content">
                                Retry
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="23 4 23 10 17 10"></polyline>
                                    <polyline points="1 20 1 14 7 14"></polyline>
                                    <path d="M3.51 9a9 9 0 0 1 14.13-3.36L23 10"></path>
                                    <path d="M20.49 15a9 9 0 0 1-14.13 3.36L1 14"></path>
                                </svg>
                            </span>
                        </Button>
                        {errorMessage?.includes("API 401") && (
                            <Button
                                onClick={disconnect}
                                variant="ghost"
                                className="gate-secondary-btn"
                            >
                                Sign out
                            </Button>
                        )}
                    </div>
                </div>

                <div className="gate-blob-1"></div>
                <div className="gate-blob-2"></div>

                <style jsx>{`
                    .gate-container {
                        position: relative;
                        min-height: 400px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        padding: 2rem;
                        overflow: hidden;
                        border-radius: 24px;
                    }

                    .gate-glass-card {
                        position: relative;
                        z-index: 10;
                        width: 100%;
                        max-width: 480px;
                        background: rgba(13, 17, 23, 0.6);
                        backdrop-filter: blur(20px);
                        border: 1px solid rgba(255, 255, 255, 0.08);
                        border-radius: 24px;
                        padding: 3rem;
                        text-align: center;
                        box-shadow:
                            0 25px 50px -12px rgba(0, 0, 0, 0.5),
                            0 0 0 1px rgba(255, 255, 255, 0.05) inset;
                        animation: scaleUp 0.5s cubic-bezier(0.16, 1, 0.3, 1);
                    }

                    .gate-icon-wrapper {
                        display: inline-flex;
                        padding: 1rem;
                        background: rgba(124, 92, 255, 0.1);
                        border-radius: 20px;
                        margin-bottom: 2rem;
                        border: 1px solid rgba(124, 92, 255, 0.2);
                        color: #7c5cff;
                    }

                    .gate-title {
                        font-size: 1.75rem;
                        font-weight: 800;
                        color: white;
                        margin-bottom: 1rem;
                        letter-spacing: -0.02em;
                    }

                    .gate-description {
                        color: var(--color-muted);
                        line-height: 1.6;
                        font-size: 1rem;
                        margin-bottom: 2.5rem;
                    }

                    .gate-actions {
                        display: flex;
                        gap: 0.75rem;
                        justify-content: center;
                    }

                    .gate-submit-btn,
                    .gate-secondary-btn {
                        height: 56px !important;
                        border-radius: 16px !important;
                        font-size: 1.05rem !important;
                        font-weight: 700 !important;
                    }

                    .gate-submit-btn {
                        min-width: 180px;
                    }

                    .gate-secondary-btn {
                        min-width: 140px;
                    }

                    .btn-content {
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        gap: 0.75rem;
                    }

                    .gate-blob-1, .gate-blob-2 {
                        position: absolute;
                        width: 300px;
                        height: 300px;
                        border-radius: 50%;
                        filter: blur(80px);
                        z-index: 1;
                        opacity: 0.1;
                        pointer-events: none;
                    }

                    .gate-blob-1 {
                        top: -50px;
                        left: -50px;
                        background: #7c5cff;
                        animation: float 15s infinite alternate;
                    }

                    .gate-blob-2 {
                        bottom: -50px;
                        right: -50px;
                        background: #a855f7;
                        animation: float 18s infinite alternate-reverse;
                    }

                    @keyframes float {
                        0% { transform: translate(0, 0) scale(1); }
                        100% { transform: translate(40px, 40px) scale(1.1); }
                    }

                    @keyframes scaleUp {
                        from { opacity: 0; transform: scale(0.95); }
                        to { opacity: 1; transform: scale(1); }
                    }
                `}</style>
            </div>
        );
    }

    if (gateState === "missing") {
        return (
            <div className="gate-container">
                <div className="gate-glass-card">
                    <div className="gate-icon-wrapper">
                        <div className="gate-icon">
                            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                                <circle cx="12" cy="7" r="4"></circle>
                            </svg>
                        </div>
                    </div>
                    <h2 className="gate-title">Artist Profile Required</h2>
                    <p className="gate-description">
                        To share your music with the world and manage your tracks, you first need to create your artist identity.
                    </p>
                    <Button
                        onClick={navigateToOnboarding}
                        variant="primary"
                        className="gate-submit-btn"
                    >
                        <span className="btn-content">
                            Create Artist Profile
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="5" y1="12" x2="19" y2="12"></line>
                                <polyline points="12 5 19 12 12 19"></polyline>
                            </svg>
                        </span>
                    </Button>
                </div>

                {/* Decorative background elements */}
                <div className="gate-blob-1"></div>
                <div className="gate-blob-2"></div>

                <style jsx>{`
                    .gate-container {
                        position: relative;
                        min-height: 400px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        padding: 2rem;
                        overflow: hidden;
                        border-radius: 24px;
                    }

                    .gate-glass-card {
                        position: relative;
                        z-index: 10;
                        width: 100%;
                        max-width: 480px;
                        background: rgba(13, 17, 23, 0.6);
                        backdrop-filter: blur(20px);
                        border: 1px solid rgba(255, 255, 255, 0.08);
                        border-radius: 24px;
                        padding: 3rem;
                        text-align: center;
                        box-shadow: 
                            0 25px 50px -12px rgba(0, 0, 0, 0.5),
                            0 0 0 1px rgba(255, 255, 255, 0.05) inset;
                        animation: scaleUp 0.5s cubic-bezier(0.16, 1, 0.3, 1);
                    }

                    .gate-icon-wrapper {
                        display: inline-flex;
                        padding: 1rem;
                        background: rgba(124, 92, 255, 0.1);
                        border-radius: 20px;
                        margin-bottom: 2rem;
                        border: 1px solid rgba(124, 92, 255, 0.2);
                        color: #7c5cff;
                    }

                    .gate-title {
                        font-size: 1.75rem;
                        font-weight: 800;
                        color: white;
                        margin-bottom: 1rem;
                        letter-spacing: -0.02em;
                    }

                    .gate-description {
                        color: var(--color-muted);
                        line-height: 1.6;
                        font-size: 1rem;
                        margin-bottom: 2.5rem;
                    }

                    .gate-submit-btn {
                        width: 100%;
                        height: 64px !important; /* Increased from 52px */
                        border-radius: 16px !important;
                        font-size: 1.1rem !important;
                        font-weight: 700 !important;
                        letter-spacing: 0.01em;
                        transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) !important;
                        background: linear-gradient(135deg, #7c5cff 0%, #a855f7 100%) !important;
                        border: 1px solid rgba(255, 255, 255, 0.1) !important;
                        box-shadow: 
                            0 8px 16px -4px rgba(124, 92, 255, 0.4),
                            0 0 20px rgba(124, 92, 255, 0.1) !important;
                    }

                    .gate-submit-btn:hover {
                        transform: translateY(-2px);
                        box-shadow: 0 12px 24px -4px rgba(124, 92, 255, 0.5) !important;
                    }

                    .btn-content {
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        gap: 0.75rem;
                    }

                    .gate-blob-1, .gate-blob-2 {
                        position: absolute;
                        width: 300px;
                        height: 300px;
                        border-radius: 50%;
                        filter: blur(80px);
                        z-index: 1;
                        opacity: 0.1;
                        pointer-events: none;
                    }

                    .gate-blob-1 {
                        top: -50px;
                        left: -50px;
                        background: #7c5cff;
                        animation: float 15s infinite alternate;
                    }

                    .gate-blob-2 {
                        bottom: -50px;
                        right: -50px;
                        background: #a855f7;
                        animation: float 18s infinite alternate-reverse;
                    }

                    @keyframes float {
                        0% { transform: translate(0, 0) scale(1); }
                        100% { transform: translate(40px, 40px) scale(1.1); }
                    }

                    @keyframes scaleUp {
                        from { opacity: 0; transform: scale(0.95); }
                        to { opacity: 1; transform: scale(1); }
                    }
                `}</style>
            </div>
        );
    }

    return <>{children}</>;
}
