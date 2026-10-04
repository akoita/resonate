import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import SonicRadarActionCard from "./SonicRadarActionCard";

type ElementLike = { props?: { children?: unknown; [key: string]: unknown } };

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

function setup(overrides: Partial<React.ComponentProps<typeof SonicRadarActionCard>> = {}) {
    const props = {
        title: "Song",
        artistName: "Artist",
        artworkUrl: null,
        badges: [{ label: "New to you", tone: "confirmed" as const }, { label: "Added today" }],
        saving: false,
        onOpen: vi.fn(),
        onPlay: vi.fn(),
        onSave: vi.fn(),
        ...overrides,
    };
    return props;
}

function press(props: ReturnType<typeof setup>, label: string) {
    const stopPropagation = vi.fn();
    const button = findElement(SonicRadarActionCard(props), (p) => p["aria-label"] === label);
    (button?.props?.onClick as (e: unknown) => void)({ stopPropagation });
    return stopPropagation;
}

describe("SonicRadarActionCard", () => {
    it("renders title, artist, badges with tone, and the Play and Save buttons", () => {
        const html = renderToStaticMarkup(<SonicRadarActionCard {...setup()} />);

        expect(html).toContain("Song");
        expect(html).toContain("Artist");
        expect(html).toMatch(/sonic-radar-stem-badge sonic-radar-stem-badge--confirmed">New to you</);
        expect(html).toMatch(/class="sonic-radar-stem-badge">Added today</);
        expect(html).toContain('aria-label="Play Song"');
        expect(html).toContain('aria-label="Save Song"');
        expect(html).toContain(">Save</button>");
    });

    it("shows artwork when there is some and a placeholder otherwise", () => {
        expect(renderToStaticMarkup(<SonicRadarActionCard {...setup({ artworkUrl: "https://x.test/a.jpg" })} />)).toContain(
            'src="https://x.test/a.jpg"',
        );
        expect(renderToStaticMarkup(<SonicRadarActionCard {...setup()} />)).toContain("sonic-radar-card-art-placeholder");
    });

    it("disables Save and says Saving… while busy", () => {
        const html = renderToStaticMarkup(<SonicRadarActionCard {...setup({ saving: true })} />);
        expect(html).toContain("Saving…");
        expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Save Song"|<button[^>]*aria-label="Save Song"[^>]*disabled=""/);
    });

    it("Play and Save stop propagation so the card does not open", () => {
        const props = setup();

        expect(press(props, "Play Song")).toHaveBeenCalled();
        expect(props.onPlay).toHaveBeenCalledTimes(1);
        expect(props.onSave).not.toHaveBeenCalled();

        expect(press(props, "Save Song")).toHaveBeenCalled();
        expect(props.onSave).toHaveBeenCalledTimes(1);
        expect(props.onOpen).not.toHaveBeenCalled();
    });

    it("opens the release when the card itself is clicked", () => {
        const props = setup();
        const root = findElement(SonicRadarActionCard(props), (p) => p.className === "sonic-radar-card");
        (root?.props?.onClick as () => void)();
        expect(props.onOpen).toHaveBeenCalledTimes(1);
    });
});
