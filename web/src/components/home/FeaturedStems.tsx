"use client";

import { Release } from "../../lib/api";
import { StemCard, FeaturedStem } from "./StemCard";

interface FeaturedStemsProps {
    releases: Release[];
}

/**
 * Extracts stems from releases and renders a horizontally scrollable
 * "Featured Stems" section for the home page.
 *
 * Prioritizes stem-type variety so the section showcases different
 * stem types rather than showing 8 vocals in a row.
 */
export function FeaturedStems({ releases }: FeaturedStemsProps) {
    const stems = extractFeaturedStems(releases, 8);

    if (stems.length === 0) return null;

    return (
        <section className="home-section fade-in-up" style={{ animationDelay: "0.15s" }}>
            <div className="section-header">
                <h2 className="home-section-title text-gradient">Featured Stems</h2>
                <span className="stems-count-badge">{stems.length} stems</span>
            </div>

            <div className="stems-scroll-container">
                <div className="stems-scroll-track">
                    {stems.map((stem) => (
                        <StemCard key={stem.id} stem={stem} />
                    ))}
                </div>
            </div>

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

        .stems-scroll-container {
          overflow-x: auto;
          overflow-y: hidden;
          margin: 0 -16px;
          padding: 0 16px;
          scrollbar-width: thin;
          scrollbar-color: rgba(255, 255, 255, 0.08) transparent;
        }

        .stems-scroll-container::-webkit-scrollbar {
          height: 4px;
        }

        .stems-scroll-container::-webkit-scrollbar-track {
          background: transparent;
        }

        .stems-scroll-container::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.08);
          border-radius: 10px;
        }

        .stems-scroll-track {
          display: flex;
          gap: 20px;
          padding-bottom: 8px;
        }
      `}</style>
        </section>
    );
}

/**
 * Flatten releases → tracks → stems, enriching each stem
 * with parent metadata. Prioritizes variety of stem types.
 */
function extractFeaturedStems(releases: Release[], limit: number): FeaturedStem[] {
    const all: FeaturedStem[] = [];

    for (const release of releases) {
        if (!release.tracks) continue;
        for (const track of release.tracks) {
            if (!track.stems) continue;
            for (const stem of track.stems) {
                all.push({
                    id: stem.id,
                    type: stem.type,
                    uri: stem.uri,
                    ipnftId: stem.ipnftId,
                    durationSeconds: stem.durationSeconds,
                    isEncrypted: stem.isEncrypted,
                    trackTitle: track.title,
                    trackId: track.id,
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

    // Round-robin by type
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
