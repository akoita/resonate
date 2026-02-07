"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Release } from "../../lib/api";
import { ReleaseHero } from "./ReleaseHero";

interface HeroCarouselProps {
    releases: Release[];
}

/**
 * Hero banner carousel — cycles through the latest releases
 * with smooth crossfade transitions, auto-advance, and dot indicators.
 */
export function HeroCarousel({ releases }: HeroCarouselProps) {
    const [activeIndex, setActiveIndex] = useState(0);
    const autoRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const count = releases.length;

    const goTo = useCallback(
        (i: number) => setActiveIndex(((i % count) + count) % count),
        [count],
    );

    const next = useCallback(() => goTo(activeIndex + 1), [activeIndex, goTo]);

    // Auto-advance every 7s
    useEffect(() => {
        autoRef.current = setInterval(next, 7000);
        return () => { if (autoRef.current) clearInterval(autoRef.current); };
    }, [next]);

    const pause = () => { if (autoRef.current) clearInterval(autoRef.current); };
    const resume = () => { pause(); autoRef.current = setInterval(next, 7000); };

    if (count === 0) return null;

    return (
        <section
            className="hero-carousel fade-in-up"
            onMouseEnter={pause}
            onMouseLeave={resume}
        >
            <div className="hero-carousel-track">
                {releases.map((release, i) => (
                    <div
                        key={release.id}
                        className={`hero-carousel-slide ${i === activeIndex ? "active" : ""}`}
                    >
                        <ReleaseHero release={release} />
                    </div>
                ))}
            </div>

            {/* Navigation arrows */}
            {count > 1 && (
                <>
                    <button
                        className="hero-carousel-arrow hero-arrow-left"
                        onClick={() => goTo(activeIndex - 1)}
                        aria-label="Previous release"
                    >
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="15 18 9 12 15 6" />
                        </svg>
                    </button>
                    <button
                        className="hero-carousel-arrow hero-arrow-right"
                        onClick={() => goTo(activeIndex + 1)}
                        aria-label="Next release"
                    >
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="9 18 15 12 9 6" />
                        </svg>
                    </button>
                </>
            )}

            {/* Dot indicators */}
            {count > 1 && (
                <div className="hero-carousel-dots">
                    {releases.map((r, i) => (
                        <button
                            key={r.id}
                            className={`hero-dot ${i === activeIndex ? "active" : ""}`}
                            onClick={() => goTo(i)}
                            aria-label={`Go to release ${i + 1}`}
                        />
                    ))}
                </div>
            )}

            <style jsx>{`
                .hero-carousel {
                    position: relative;
                    width: 100%;
                }

                .hero-carousel-track {
                    position: relative;
                    width: 100%;
                    min-height: 520px;
                }

                .hero-carousel-slide {
                    position: absolute;
                    inset: 0;
                    opacity: 0;
                    pointer-events: none;
                    transition: opacity 0.8s cubic-bezier(0.4, 0, 0.2, 1);
                    z-index: 0;
                }

                .hero-carousel-slide.active {
                    opacity: 1;
                    pointer-events: auto;
                    position: relative;
                    z-index: 1;
                }

                .hero-carousel-arrow {
                    position: absolute;
                    top: 50%;
                    transform: translateY(-50%);
                    z-index: 20;
                    width: 48px;
                    height: 48px;
                    border-radius: 50%;
                    border: 1px solid rgba(255, 255, 255, 0.12);
                    background: rgba(0, 0, 0, 0.4);
                    backdrop-filter: blur(12px);
                    color: rgba(255, 255, 255, 0.7);
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: all 0.25s ease;
                    opacity: 0;
                }

                .hero-carousel:hover .hero-carousel-arrow {
                    opacity: 1;
                }

                .hero-carousel-arrow:hover {
                    background: rgba(255, 255, 255, 0.12);
                    color: #fff;
                    border-color: rgba(255, 255, 255, 0.25);
                    transform: translateY(-50%) scale(1.1);
                }

                .hero-arrow-left {
                    left: 20px;
                }

                .hero-arrow-right {
                    right: 20px;
                }

                .hero-carousel-dots {
                    display: flex;
                    justify-content: center;
                    gap: 10px;
                    margin-top: 20px;
                }

                .hero-dot {
                    width: 10px;
                    height: 10px;
                    border-radius: 50%;
                    border: none;
                    background: rgba(255, 255, 255, 0.15);
                    cursor: pointer;
                    transition: all 0.35s ease;
                    padding: 0;
                }

                .hero-dot.active {
                    background: var(--color-primary, #7c3aed);
                    width: 32px;
                    border-radius: 5px;
                    box-shadow: 0 0 12px rgba(124, 58, 237, 0.4);
                }

                .hero-dot:hover:not(.active) {
                    background: rgba(255, 255, 255, 0.35);
                }
            `}</style>
        </section>
    );
}
