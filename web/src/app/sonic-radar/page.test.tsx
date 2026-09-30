import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscoveryJournal } from "../../lib/api";

const hookState: {
    journal: DiscoveryJournal | null;
    isLoading: boolean;
    error: string | null;
} = { journal: null, isLoading: false, error: null };

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("../../components/auth/AuthGate", () => ({
    default: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));
vi.mock("../../hooks/useDiscoveryJournal", () => ({
    useDiscoveryJournal: () => ({ ...hookState, refetch: vi.fn() }),
}));
vi.mock("../../lib/uiStore", () => ({
    useUIStore: () => ({ setTracksToAddToPlaylist: vi.fn() }),
}));
vi.mock("../../lib/localLibrary", () => ({ saveTracksMetadata: vi.fn() }));

import SonicRadarPage from "./page";

const base = {
    schemaVersion: "discovery-journal/v1" as const,
    window: { days: 28, from: "2026-05-18T00:00:00.000Z", to: "2026-06-15T00:00:00.000Z" },
};

function journalWith(nextActionOnSecond = false): DiscoveryJournal {
    const item = (id: string, artistId: string, withAction: boolean) => ({
        trackId: id,
        title: `Title ${id}`,
        artistId,
        artistName: `Artist ${artistId}`,
        releaseId: `r-${id}`,
        releaseTitle: `Release ${id}`,
        artworkUrl: null,
        hasUploadedArtwork: false,
        artworkRevision: 1,
        resonatedAt: "2026-06-14T09:00:00.000Z",
        followUp: "replayed" as const,
        discovery: id === "t1",
        reason: { code: "listening_pattern", text: "Learned listening pattern fit" },
        nextAction: withAction
            ? { kind: "artist_page" as const, label: "Visit artist page", href: `/artist/${artistId}` }
            : null,
    });
    return {
        ...base,
        headline: { resonantDiscoveriesThisWeek: 1, newArtistsThisWeek: 1 },
        groups: [
            {
                key: "day:2026-06-14",
                sessionId: null,
                date: "2026-06-14",
                items: [item("t1", "a1", true), item("t2", "a1", nextActionOnSecond)],
            },
        ],
    };
}

beforeEach(() => {
    hookState.journal = null;
    hookState.isLoading = false;
    hookState.error = null;
});

describe("SonicRadarPage (discovery journal)", () => {
    it("shows an honest empty state with a way to start a session", () => {
        hookState.journal = { ...base, headline: { resonantDiscoveriesThisWeek: 0, newArtistsThisWeek: 0 }, groups: [] };
        const html = renderToStaticMarkup(<SonicRadarPage />);

        expect(html).toContain("No resonant discoveries yet — tracks you finish and then replay or save show up here.");
        expect(html).toMatch(/<a[^>]*href="\/agent"[^>]*>Start a session<\/a>/);
        expect(html).not.toContain("sonic-radar-stats");
    });

    it("lists resonant tracks with reasons, headline numbers and one next action per artist", () => {
        hookState.journal = journalWith(false);
        const html = renderToStaticMarkup(<SonicRadarPage />);

        expect(html).toContain("Title t1");
        expect(html).toContain("Title t2");
        expect(html).toContain("Learned listening pattern fit");
        expect(html).toContain("New to you");
        expect(html).toContain("Resonant discovery this week");
        expect(html).toContain("New artist this week");
        expect((html.match(/Visit artist page/g) ?? []).length).toBe(1);
    });

    it("has no price, spend, license or transaction copy", () => {
        hookState.journal = journalWith(false);
        const html = renderToStaticMarkup(<SonicRadarPage />);

        const text = html.replace(/<[^>]+>/g, " ");
        expect(text).not.toMatch(/Total Spent|\$\d|license|Personal|Commercial|Remix|negotiated|secured|stem|price/i);
    });

    it("shows a retry state when loading failed and nothing is cached", () => {
        hookState.error = "We could not load your discoveries. Try again in a moment.";
        const html = renderToStaticMarkup(<SonicRadarPage />);

        expect(html).toContain("We could not load your discoveries.");
        expect(html).toContain("Try again");
    });
});
