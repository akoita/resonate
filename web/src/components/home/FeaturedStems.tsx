"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Release } from "../../lib/api";
import { StemCard, FeaturedStem } from "./StemCard";
import { useBreakpoint } from "../../hooks/useBreakpoint";

/** How many most-recent releases to source stems from */
const MAX_RECENT_RELEASES = 3;

interface FeaturedStemsProps {
    releases: Release[];
}

/**
 * Featured Stems carousel for the home page.
 * Shows stems from the latest releases in a sliding carousel
 * with prev/next arrows, dot indicators, and auto-advance.
 */
export function FeaturedStems({ releases }: FeaturedStemsProps) {
    const stems = useMemo(
        () => extractFeaturedStems(releases, MAX_RECENT_RELEASES, 12),
        [releases],
    );
    const trackRef = useRef<HTMLDivElement>(null);
    const viewportRef = useRef<HTMLDivElement>(null);
    const [page, setPage] = useState(0);
    const autoPlayRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const { isPhone } = useBreakpoint();

    // Responsive cards-per-page — derived purely, no setState in effect
    const [viewportWidth, setViewportWidth] = useState(
        typeof window !== "undefined" ? window.innerWidth : 1200,
    );

    useEffect(() => {
        const onResize = () => setViewportWidth(window.innerWidth);
        // Fire once on mount to sync past the SSR/hydration default (1200)
        // that otherwise persisted until the user resized the window —
        // phone visitors ended up with desktop `cardsPerPage` and cards
        // crushed to ~80px wide (#603 follow-up).
        onResize();
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, []);

    const cardsPerPage = viewportWidth < 640 ? 1
        : viewportWidth < 900 ? 2
            : viewportWidth < 1200 ? 3
                : 4;

    const totalPages = Math.max(1, Math.ceil(stems.length / cardsPerPage));

    // Clamp page when totalPages changes (derived, avoids setState-in-effect)
    const safePage = Math.min(page, totalPages - 1);

    const goTo = useCallback((p: number) => {
        setPage(Math.max(0, Math.min(p, totalPages - 1)));
    }, [totalPages]);

    const next = useCallback(() => goTo(safePage < totalPages - 1 ? safePage + 1 : 0), [safePage, totalPages, goTo]);
    const prev = useCallback(() => goTo(safePage > 0 ? safePage - 1 : totalPages - 1), [safePage, totalPages, goTo]);

    // Auto-advance every 6s on desktop/tablet. On phone users drive the
    // native scroll-snap carousel themselves — an auto-advance would
    // fight their swipe and feel broken on touch.
    useEffect(() => {
        if (isPhone) return;
        autoPlayRef.current = setInterval(next, 6000);
        return () => { if (autoPlayRef.current) clearInterval(autoPlayRef.current); };
    }, [next, isPhone]);

    const pauseAuto = () => { if (autoPlayRef.current) clearInterval(autoPlayRef.current); };
    const resumeAuto = () => {
        if (isPhone) return;
        pauseAuto();
        autoPlayRef.current = setInterval(next, 6000);
    };

    // On phone, sync the dot indicator with the native scroll position so
    // the active dot always matches the centered card as the user swipes.
    useEffect(() => {
        if (!isPhone) return;
        const viewport = viewportRef.current;
        if (!viewport) return;
        let raf = 0;
        const onScroll = () => {
            cancelAnimationFrame(raf);
            raf = requestAnimationFrame(() => {
                const slides = Array.from(
                    viewport.querySelectorAll<HTMLElement>(".carousel-slide"),
                );
                if (slides.length === 0) return;
                const center = viewport.scrollLeft + viewport.clientWidth / 2;
                let bestIdx = 0;
                let bestDist = Infinity;
                slides.forEach((s, i) => {
                    const slideCenter = s.offsetLeft + s.offsetWidth / 2;
                    const d = Math.abs(center - slideCenter);
                    if (d < bestDist) { bestDist = d; bestIdx = i; }
                });
                setPage(bestIdx);
            });
        };
        viewport.addEventListener("scroll", onScroll, { passive: true });
        onScroll();
        return () => {
            cancelAnimationFrame(raf);
            viewport.removeEventListener("scroll", onScroll);
        };
    }, [isPhone, stems.length]);

    // Dot click: on phone, scroll natively to the chosen slide. On
    // desktop, keep the existing JS-driven page transform.
    const handleDotClick = useCallback((i: number) => {
        if (isPhone && viewportRef.current) {
            const slides = viewportRef.current.querySelectorAll<HTMLElement>(".carousel-slide");
            const target = slides[i];
            if (target) {
                viewportRef.current.scrollTo({
                    left: target.offsetLeft - (viewportRef.current.clientWidth - target.offsetWidth) / 2,
                    behavior: "smooth",
                });
                return;
            }
        }
        goTo(i);
    }, [isPhone, goTo]);

    if (stems.length === 0) return null;

    const offset = -(safePage * 100);

    return (
        <section
            className="home-section fade-in-up"
            style={{ animationDelay: "0.15s" }}
            onMouseEnter={pauseAuto}
            onMouseLeave={resumeAuto}
        >
            <div className="section-header">
                <h2 className="home-section-title text-gradient">Featured Stems</h2>
                <span className="stems-count-badge">{stems.length} stems</span>
            </div>

            <div className="carousel-wrapper">
                {/* Prev arrow */}
                <button className="carousel-arrow carousel-arrow-left" onClick={prev} aria-label="Previous stems">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="15 18 9 12 15 6" />
                    </svg>
                </button>

                {/* Track */}
                <div className="carousel-viewport" ref={viewportRef}>
                    <div
                        ref={trackRef}
                        className="carousel-track"
                        style={{ transform: `translateX(${offset}%)` }}
                    >
                        {stems.map((stem) => (
                            <div
                                key={stem.id}
                                className="carousel-slide"
                                style={{ flex: `0 0 ${100 / cardsPerPage}%` }}
                            >
                                <StemCard stem={stem} />
                            </div>
                        ))}
                    </div>
                </div>

                {/* Next arrow */}
                <button className="carousel-arrow carousel-arrow-right" onClick={next} aria-label="Next stems">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6" />
                    </svg>
                </button>
            </div>

            {/* Dot indicators — one per stem on phone (scroll-snap,
             * each slide is its own snap target), one per page on
             * wider viewports (transform-based paging). */}
            {(() => {
                const dotCount = isPhone ? stems.length : totalPages;
                if (dotCount <= 1) return null;
                return (
                    <div className="carousel-dots">
                        {Array.from({ length: dotCount }, (_, i) => (
                            <button
                                key={i}
                                className={`carousel-dot ${i === safePage ? "active" : ""}`}
                                onClick={() => handleDotClick(i)}
                                aria-label={isPhone ? `Go to stem ${i + 1}` : `Go to page ${i + 1}`}
                            />
                        ))}
                    </div>
                );
            })()}

            <style jsx>{`
                .stems-count-badge {
                    font-size: 11px;
                    font-weight: 700;
                    color: var(--color-muted);
                    background: rgba(255, 255, 255, 0.04);
                    border: 1px solid rgba(255, 255, 255, 0.06);
                    padding: 4px 12px;
                    border-radius: 20px;
                    letter-spacing: 0.05em;
                }

                .carousel-wrapper {
                    position: relative;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }

                .carousel-viewport {
                    overflow: hidden;
                    flex: 1;
                    border-radius: 16px;
                }

                .carousel-track {
                    display: flex;
                    transition: transform 0.5s cubic-bezier(0.4, 0, 0.2, 1);
                    will-change: transform;
                }

                .carousel-slide {
                    padding: 0 10px;
                    box-sizing: border-box;
                    display: flex;
                    justify-content: center;
                }

                /* Make StemCard fill the slide width */
                .carousel-slide :global(.stem-card) {
                    min-width: unset;
                    max-width: unset;
                    width: 100%;
                }

                .carousel-arrow {
                    flex-shrink: 0;
                    width: 40px;
                    height: 40px;
                    border-radius: 50%;
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    background: rgba(255, 255, 255, 0.04);
                    color: rgba(255, 255, 255, 0.7);
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: all 0.25s ease;
                    backdrop-filter: blur(8px);
                }

                .carousel-arrow:hover {
                    background: rgba(255, 255, 255, 0.1);
                    color: #fff;
                    border-color: rgba(255, 255, 255, 0.2);
                    transform: scale(1.1);
                }

                .carousel-dots {
                    display: flex;
                    justify-content: center;
                    gap: 8px;
                    margin-top: 16px;
                }

                .carousel-dot {
                    width: 8px;
                    height: 8px;
                    border-radius: 50%;
                    border: none;
                    background: rgba(255, 255, 255, 0.15);
                    cursor: pointer;
                    transition: all 0.3s ease;
                    padding: 0;
                }

                .carousel-dot.active {
                    background: var(--color-primary, #7c3aed);
                    width: 24px;
                    border-radius: 4px;
                }

                .carousel-dot:hover:not(.active) {
                    background: rgba(255, 255, 255, 0.3);
                }

                /* Phone: switch from JS-transform paging to native
                 * CSS scroll-snap with peek cards on both sides.
                 * Cards are 80% of the viewport so the previous + next
                 * stems poke in from the edges — matches the native
                 * Spotify / Apple Music pattern and tells the user "you
                 * can swipe" without needing arrows. The JS transform
                 * on .carousel-track is explicitly overridden so it
                 * doesn't fight the native scroll. */
                @media (max-width: 640px) {
                    .carousel-arrow {
                        display: none;
                    }

                    .carousel-wrapper {
                        gap: 0;
                    }

                    .carousel-viewport {
                        overflow-x: auto;
                        overflow-y: hidden;
                        scroll-snap-type: x mandatory;
                        scroll-padding: 0 10%;
                        -webkit-overflow-scrolling: touch;
                        scrollbar-width: none;
                        border-radius: 0;
                    }

                    .carousel-viewport::-webkit-scrollbar {
                        display: none;
                    }

                    .carousel-track {
                        transform: none !important;
                    }

                    .carousel-slide {
                        flex: 0 0 80% !important;
                        scroll-snap-align: center;
                        padding: 0 6px;
                    }

                    /* Fades at the outer edges hint that the peek cards
                     * aren't clipped by accident — they sit intentionally
                     * under a soft gradient. */
                    .carousel-wrapper::before,
                    .carousel-wrapper::after {
                        content: "";
                        position: absolute;
                        top: 0;
                        bottom: 0;
                        width: 24px;
                        pointer-events: none;
                        z-index: 2;
                    }
                    .carousel-wrapper::before {
                        left: 0;
                        background: linear-gradient(
                            90deg,
                            var(--studio-bg, #050508) 0%,
                            transparent 100%
                        );
                    }
                    .carousel-wrapper::after {
                        right: 0;
                        background: linear-gradient(
                            270deg,
                            var(--studio-bg, #050508) 0%,
                            transparent 100%
                        );
                    }

                    .carousel-dots {
                        margin-top: 14px;
                        gap: 6px;
                    }

                    .carousel-dot {
                        width: 6px;
                        height: 6px;
                    }

                    .carousel-dot.active {
                        width: 18px;
                    }
                }
            `}</style>
        </section>
    );
}

/**
 * Flatten releases → tracks → stems, enriching each stem
 * with parent metadata. Only considers the N most recent releases.
 * Prioritizes variety of stem types via round-robin.
 */
function extractFeaturedStems(
    releases: Release[],
    maxReleases: number,
    limit: number,
): FeaturedStem[] {
    // Sort by createdAt descending and take only the most recent releases
    const sorted = [...releases]
        .sort((a, b) => {
            const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return db - da;
        })
        .slice(0, maxReleases);

    const all: FeaturedStem[] = [];

    for (const release of sorted) {
        if (!release.tracks) continue;
        for (const track of release.tracks) {
            if (!track.stems) continue;
            for (const stem of track.stems) {
                if (stem.type.toUpperCase() === "ORIGINAL") continue;
                all.push({
                    id: stem.id,
                    type: stem.type,
                    uri: stem.uri,
                    ipnftId: stem.ipnftId,
                    durationSeconds: stem.durationSeconds,
                    isEncrypted: stem.isEncrypted,
                    trackTitle: track.title,
                    trackId: track.id,
                    trackCreatedAt: track.createdAt,
                    trackStems: track.stems.map((s) => ({
                        id: s.id,
                        uri: s.uri,
                        type: s.type,
                        durationSeconds: s.durationSeconds,
                        isEncrypted: s.isEncrypted,
                        encryptionMetadata: s.encryptionMetadata,
                    })),
                    releaseId: release.id,
                    releaseTitle: release.title,
                    releaseArtist:
                        release.primaryArtist ||
                        release.artist?.displayName ||
                        "Unknown Artist",
                    releaseArtworkUrl: release.artworkUrl,
                });
            }
        }
    }

    if (all.length <= limit) return all;

    // Prioritize variety by picking one of each type first, then filling
    const byType = new Map<string, FeaturedStem[]>();
    for (const s of all) {
        const key = s.type.toLowerCase();
        if (!byType.has(key)) byType.set(key, []);
        byType.get(key)!.push(s);
    }

    const result: FeaturedStem[] = [];
    const seenIds = new Set<string>();

    let added = true;
    while (added && result.length < limit) {
        added = false;
        for (const [, stems] of byType) {
            if (result.length >= limit) break;
            const next = stems.find((s) => !seenIds.has(s.id));
            if (next) {
                result.push(next);
                seenIds.add(next.id);
                added = true;
            }
        }
    }

    return result;
}
