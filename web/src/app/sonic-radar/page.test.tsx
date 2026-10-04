import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscoveryJournal, DiscoveryJournalNewReleaseItem, DiscoveryJournalPendingItem } from "../../lib/api";

// Static rendering never runs effects or re-renders, so keep state in call-order
// slots (they survive across renders) and read handlers off the element tree.
const slots: unknown[] = [];
let slotIndex = 0;
vi.mock("react", async (importOriginal) => {
    const actual = await importOriginal<typeof import("react")>();
    return {
        ...actual,
        useState: <T,>(initial: T | (() => T)) => {
            const index = slotIndex++;
            if (!(index in slots)) {
                slots[index] = typeof initial === "function" ? (initial as () => T)() : initial;
            }
            const setState = (next: T | ((previous: T) => T)) => {
                slots[index] = typeof next === "function" ? (next as (previous: T) => T)(slots[index] as T) : next;
            };
            return [slots[index] as T, setState] as const;
        },
    };
});

const hookState: {
    journal: DiscoveryJournal | null;
    isLoading: boolean;
    error: string | null;
} = { journal: null, isLoading: false, error: null };

const push = vi.fn();
const refetch = vi.fn(async () => undefined);
const addToast = vi.fn();
const authState: { token: string | null } = { token: "tok" };
const saveTrackMetadataAuthenticated = vi.fn(async (track: unknown) => track);
const saveTracksMetadata = vi.fn();
const playQueue = vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined);
const recordProductAnalyticsFromBrowser = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("../../components/auth/AuthProvider", () => ({ useAuth: () => ({ token: authState.token }) }));
vi.mock("../../components/ui/Toast", () => ({ useToast: () => ({ addToast }) }));
vi.mock("../../lib/productAnalytics", () => ({
    recordProductAnalyticsFromBrowser: (...args: unknown[]) => recordProductAnalyticsFromBrowser(...args),
}));
vi.mock("../../lib/discoveryAttribution", () => ({
    getDiscoveryAttribution: () => ({ surface: "dj" }),
}));
vi.mock("../../components/auth/AuthGate", () => ({
    default: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));
vi.mock("../../hooks/useDiscoveryJournal", () => ({
    useDiscoveryJournal: () => ({ ...hookState, refetch }),
}));
vi.mock("../../lib/uiStore", () => ({
    useUIStore: () => ({ setTracksToAddToPlaylist: vi.fn() }),
}));
vi.mock("../../lib/playerContext", () => ({
    usePlayer: () => ({ playQueue: (...args: unknown[]) => playQueue(...args) }),
}));
vi.mock("../../lib/localLibrary", () => ({
    saveTracksMetadata: (...args: unknown[]) => saveTracksMetadata(...args),
    saveTrackMetadataAuthenticated: (...args: unknown[]) => saveTrackMetadataAuthenticated(...(args as [unknown])),
}));

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
    vi.clearAllMocks();
    slots.length = 0;
    hookState.journal = null;
    hookState.isLoading = false;
    hookState.error = null;
    authState.token = "tok";
    saveTrackMetadataAuthenticated.mockImplementation(async (track: unknown) => track);
    playQueue.mockImplementation(async () => undefined);
});

afterEach(() => {
    vi.restoreAllMocks();
});

function pendingItem(id: string, overrides: Partial<DiscoveryJournalPendingItem> = {}): DiscoveryJournalPendingItem {
    return {
        trackId: id,
        title: `Pending ${id}`,
        artistId: `a-${id}`,
        artistName: `Artist ${id}`,
        releaseId: `r-${id}`,
        releaseTitle: `Release ${id}`,
        artworkUrl: null,
        hasUploadedArtwork: false,
        artworkRevision: 1,
        completedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
        followUpBy: new Date(Date.now() + 3 * 86_400_000 - 1000).toISOString(),
        discovery: false,
        ...overrides,
    };
}

function emptyJournal(pending?: DiscoveryJournalPendingItem[]): DiscoveryJournal {
    return {
        ...base,
        headline: { resonantDiscoveriesThisWeek: 0, newArtistsThisWeek: 0 },
        groups: [],
        ...(pending ? { pending } : {}),
    };
}

function render() {
    slotIndex = 0;
    return renderToStaticMarkup(<SonicRadarPage />);
}

type ElementLike = { props?: { children?: unknown; onClick?: (e: unknown) => void; [key: string]: unknown } };

/** Walk the unrendered element tree for the first element matching `match`. */
function findElement(node: unknown, match: (props: NonNullable<ElementLike["props"]>) => boolean): ElementLike | null {
    if (Array.isArray(node)) {
        for (const child of node) {
            const found = findElement(child, match);
            if (found) return found;
        }
        return null;
    }
    const element = node as ElementLike | null;
    if (!element || typeof element !== "object" || !element.props) return null;
    if (match(element.props)) return element;
    return findElement(element.props.children, match);
}

function tree() {
    slotIndex = 0;
    return SonicRadarPage();
}

/** The action card element (not rendered) for a track title, with its handlers. */
function card(title: string) {
    const found = findElement(tree(), (props) => props.title === title && typeof props.onSave === "function");
    if (!found?.props) throw new Error(`No card for ${title}`);
    return found.props as { onOpen: () => void; onPlay: () => void; onSave: () => Promise<void> | void };
}

/** Handlers are fire-and-forget; let their promise chains settle. */
async function settle() {
    for (let i = 0; i < 5; i++) await Promise.resolve();
}

function newItem(id: string, overrides: Partial<DiscoveryJournalNewReleaseItem> = {}): DiscoveryJournalNewReleaseItem {
    return {
        trackId: id,
        title: `Fresh ${id}`,
        artistId: `a-${id}`,
        artistName: `Artist ${id}`,
        releaseId: `r-${id}`,
        releaseTitle: `Release ${id}`,
        artworkUrl: null,
        hasUploadedArtwork: false,
        artworkRevision: 1,
        addedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
        reason: { code: "new_from_discovered_artist", text: "New from an artist you discovered" },
        ...overrides,
    };
}

describe("SonicRadarPage (discovery journal)", () => {
    it("shows an honest empty state with a way to start a session", () => {
        hookState.journal = { ...base, headline: { resonantDiscoveriesThisWeek: 0, newArtistsThisWeek: 0 }, groups: [] };
        const html = renderToStaticMarkup(<SonicRadarPage />);

        expect(html).toContain("No resonant discoveries yet — tracks you finish and then replay or save show up here.");
        expect(html).toMatch(/<a[^>]*href="\/#ai-dj"[^>]*>Start a session<\/a>/);
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

    describe("Almost there", () => {
        it("lists tracks played through with a save button, new-artist and deadline badges", () => {
            hookState.journal = emptyJournal([pendingItem("p1", { discovery: true }), pendingItem("p2")]);
            const html = render();

            expect(html).toContain("Almost there");
            expect(html).toContain("You played these through this week. Save the ones you liked and they join your journal.");
            expect(html).toContain("Pending p1");
            expect(html).toContain("Pending p2");
            expect(html).toContain('aria-label="Save Pending p1"');
            expect((html.match(/New to you/g) ?? []).length).toBe(1);
            expect(html).toContain("Save within 3 days");
        });

        it("says last day when the follow-up window is almost over", () => {
            hookState.journal = emptyJournal([pendingItem("p1", { followUpBy: new Date(Date.now() + 3_600_000).toISOString() })]);
            expect(render()).toContain("Last day to save");
        });

        it("is hidden when pending is empty or missing", () => {
            hookState.journal = emptyJournal([]);
            expect(render()).not.toContain("Almost there");
            hookState.journal = emptyJournal();
            expect(render()).not.toContain("Almost there");
        });

        it("is hidden while loading or when the journal failed to load", () => {
            hookState.isLoading = true;
            expect(render()).not.toContain("Almost there");
            hookState.isLoading = false;
            hookState.error = "We could not load your discoveries. Try again in a moment.";
            expect(render()).not.toContain("Almost there");
        });

        it("sits above the journal feed and changes the empty-state copy", () => {
            hookState.journal = emptyJournal([pendingItem("p1")]);
            const html = render();

            expect(html).toContain("Nothing has resonated yet. Save or replay a track above and it will show up here.");
            expect(html).not.toContain("No resonant discoveries yet");
            expect(html).toMatch(/<a[^>]*href="\/#ai-dj"[^>]*>Start a session<\/a>/);

            hookState.journal = { ...journalWith(false), pending: [pendingItem("p1")] };
            const withFeed = render();
            expect(withFeed.indexOf("Almost there")).toBeGreaterThan(-1);
            expect(withFeed.indexOf("Almost there")).toBeLessThan(withFeed.indexOf("Title t1"));
        });

        it("saves the catalog track, records analytics, toasts, hides the card and refreshes the journal", async () => {
            hookState.journal = emptyJournal([pendingItem("p1"), pendingItem("p2")]);
            card("Pending p1").onSave();
            await settle();

            expect(saveTrackMetadataAuthenticated).toHaveBeenCalledTimes(1);
            expect(saveTrackMetadataAuthenticated).toHaveBeenCalledWith(
                expect.objectContaining({
                    id: "p1",
                    catalogTrackId: "p1",
                    title: "Pending p1",
                    artist: "Artist p1",
                    source: "remote",
                    releaseId: "r-p1",
                }),
                "tok",
            );
            expect(recordProductAnalyticsFromBrowser).toHaveBeenCalledWith("library.saved", {
                subjectType: "track",
                subjectId: "p1",
                payload: { trackId: "p1", surface: "dj" },
            });
            expect(addToast).toHaveBeenCalledWith({
                type: "success",
                title: "Saved",
                message: '"Pending p1" is in your library and your Sonic Radar.',
            });
            expect(refetch).toHaveBeenCalledTimes(1);

            const html = render();
            expect(html).not.toContain("Pending p1");
            expect(html).toContain("Pending p2");
        });

        it("keeps the card and toasts an error when saving fails", async () => {
            hookState.journal = emptyJournal([pendingItem("p1")]);
            vi.spyOn(console, "warn").mockImplementation(() => undefined);
            saveTrackMetadataAuthenticated.mockRejectedValueOnce(new Error("boom"));

            card("Pending p1").onSave();
            await settle();

            expect(addToast).toHaveBeenCalledWith({ type: "error", title: "Couldn't save", message: "Please try again." });
            expect(recordProductAnalyticsFromBrowser).not.toHaveBeenCalled();
            expect(refetch).not.toHaveBeenCalled();
            const html = render();
            expect(html).toContain("Pending p1");
            expect(html).not.toContain("Saving…");
        });

        it("asks to sign in instead of saving without a token", async () => {
            hookState.journal = emptyJournal([pendingItem("p1")]);
            authState.token = null;

            card("Pending p1").onSave();
            await settle();

            expect(saveTrackMetadataAuthenticated).not.toHaveBeenCalled();
            expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: "info", title: "Sign in to save" }));
            expect(render()).toContain("Pending p1");
        });

        it("opens the release when the card is clicked", () => {
            hookState.journal = emptyJournal([pendingItem("p1")]);
            card("Pending p1").onOpen();
            expect(push).toHaveBeenCalledWith("/release/r-p1");
        });

        it("offers Play next to Save and plays the track again without saving it", async () => {
            hookState.journal = emptyJournal([pendingItem("p1")]);
            expect(render()).toContain('aria-label="Play Pending p1"');

            card("Pending p1").onPlay();
            await settle();

            expect(playQueue).toHaveBeenCalledTimes(1);
            const [queue, startIndex] = playQueue.mock.calls[0] as [Array<Record<string, unknown>>, number];
            expect(startIndex).toBe(0);
            expect(queue).toHaveLength(1);
            expect(queue[0]).toMatchObject({ catalogTrackId: "p1", releaseId: "r-p1", source: "remote" });
            expect(String(queue[0].remoteUrl)).toContain("/catalog/releases/r-p1/tracks/p1/stream");
            expect(saveTrackMetadataAuthenticated).not.toHaveBeenCalled();
            expect(saveTracksMetadata).not.toHaveBeenCalled();
        });
    });

    describe("New from artists you discovered", () => {
        const withNew = (items: DiscoveryJournalNewReleaseItem[], pending?: DiscoveryJournalPendingItem[]) => {
            hookState.journal = { ...journalWith(false), ...(pending ? { pending } : {}), newFromDiscovered: items };
        };

        it("lists recent tracks with an added-ago badge, the reason, Play and Save", () => {
            withNew([newItem("n1"), newItem("n2", { addedAt: new Date().toISOString() })]);
            const html = render();

            expect(html).toContain("New from artists you discovered");
            expect(html).toContain("Recent releases from artists whose music resonated with you.");
            expect(html).toContain("Fresh n1");
            expect(html).toContain("Fresh n2");
            expect(html).toContain("Added 2 days ago");
            expect(html).toContain("Added today");
            expect((html.match(/New from an artist you discovered/g) ?? []).length).toBe(2);
            expect(html).toContain('aria-label="Play Fresh n1"');
            expect(html).toContain('aria-label="Save Fresh n1"');
        });

        it("sits above Almost there and the journal feed", () => {
            withNew([newItem("n1")], [pendingItem("p1")]);
            const html = render();

            const newAt = html.indexOf("New from artists you discovered");
            expect(newAt).toBeGreaterThan(-1);
            expect(newAt).toBeLessThan(html.indexOf("Almost there"));
            expect(html.indexOf("Almost there")).toBeLessThan(html.indexOf("Title t1"));
        });

        it("is hidden when empty, missing, loading or when the journal failed to load", () => {
            withNew([]);
            expect(render()).not.toContain("New from artists you discovered");
            hookState.journal = journalWith(false);
            expect(render()).not.toContain("New from artists you discovered");
            withNew([newItem("n1")]);
            hookState.isLoading = true;
            hookState.journal = null;
            expect(render()).not.toContain("New from artists you discovered");
            hookState.isLoading = false;
            hookState.error = "We could not load your discoveries. Try again in a moment.";
            expect(render()).not.toContain("New from artists you discovered");
        });

        it("plays a remote catalog track without saving it to the library", async () => {
            withNew([newItem("n1")]);

            card("Fresh n1").onPlay();
            await settle();

            expect(playQueue).toHaveBeenCalledTimes(1);
            const [queue, startIndex] = playQueue.mock.calls[0] as [Array<Record<string, unknown>>, number];
            expect(startIndex).toBe(0);
            expect(queue[0]).toMatchObject({
                id: "n1",
                catalogTrackId: "n1",
                releaseId: "r-n1",
                artistId: "a-n1",
                source: "remote",
            });
            expect(String(queue[0].remoteUrl)).toContain("/catalog/releases/r-n1/tracks/n1/stream");
            expect(saveTrackMetadataAuthenticated).not.toHaveBeenCalled();
            expect(saveTracksMetadata).not.toHaveBeenCalled();
            expect(recordProductAnalyticsFromBrowser).not.toHaveBeenCalled();
        });

        it("toasts an error when playback fails", async () => {
            withNew([newItem("n1")]);
            vi.spyOn(console, "warn").mockImplementation(() => undefined);
            playQueue.mockRejectedValueOnce(new Error("boom"));

            card("Fresh n1").onPlay();
            await settle();

            expect(addToast).toHaveBeenCalledWith({ type: "error", title: "Couldn't play", message: "Please try again." });
        });

        it("saves the track, records analytics, hides it and refreshes the journal", async () => {
            withNew([newItem("n1"), newItem("n2")]);

            card("Fresh n1").onSave();
            await settle();

            expect(saveTrackMetadataAuthenticated).toHaveBeenCalledWith(
                expect.objectContaining({ id: "n1", catalogTrackId: "n1", source: "remote", releaseId: "r-n1" }),
                "tok",
            );
            expect(recordProductAnalyticsFromBrowser).toHaveBeenCalledWith("library.saved", {
                subjectType: "track",
                subjectId: "n1",
                payload: { trackId: "n1", surface: "dj" },
            });
            expect(addToast).toHaveBeenCalledWith({ type: "success", title: "Saved", message: '"Fresh n1" is in your library.' });
            expect(refetch).toHaveBeenCalledTimes(1);

            const html = render();
            expect(html).not.toContain("Fresh n1");
            expect(html).toContain("Fresh n2");
        });

        it("keeps the track and toasts an error when saving fails", async () => {
            withNew([newItem("n1")]);
            vi.spyOn(console, "warn").mockImplementation(() => undefined);
            saveTrackMetadataAuthenticated.mockRejectedValueOnce(new Error("boom"));

            card("Fresh n1").onSave();
            await settle();

            expect(addToast).toHaveBeenCalledWith({ type: "error", title: "Couldn't save", message: "Please try again." });
            expect(refetch).not.toHaveBeenCalled();
            expect(render()).toContain("Fresh n1");
        });

        it("opens the release when the card is clicked", () => {
            withNew([newItem("n1")]);
            card("Fresh n1").onOpen();
            expect(push).toHaveBeenCalledWith("/release/r-n1");
        });
    });
});
