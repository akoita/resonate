"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { getArtistMe } from "../../lib/api";
import { Button } from "../ui/Button";

interface ArtistGateProps {
    children: React.ReactNode;
}

export default function ArtistGate({ children }: ArtistGateProps) {
    const { token, status } = useAuth();
    const [isArtist, setIsArtist] = useState<boolean | null>(null);
    const router = useRouter();

    useEffect(() => {
        async function checkArtist() {
            if (token && status === "authenticated") {
                try {
                    const artist = await getArtistMe(token);
                    setIsArtist(!!artist);
                } catch (error) {
                    console.error("Failed to check artist status:", error);
                    setIsArtist(false);
                }
            } else if (status === "idle" || status === "error") {
                setIsArtist(false);
            }
        }
        checkArtist();
    }, [token, status]);

    if (isArtist === null) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        );
    }

    if (!isArtist) {
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
                        onClick={() => router.push("/artist/onboarding")}
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
                        height: 52px !important;
                        border-radius: 12px !important;
                        font-size: 1rem !important;
                        font-weight: 600 !important;
                        transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) !important;
                        background: linear-gradient(135deg, #7c5cff 0%, #a855f7 100%) !important;
                        border: none !important;
                        box-shadow: 0 8px 16px -4px rgba(124, 92, 255, 0.4) !important;
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
