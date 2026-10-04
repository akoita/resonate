import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AgentMixVocabulary, ListeningLane } from "../../lib/api";
import AgentMyMixEditor from "./AgentMyMixEditor";

const lanes: ListeningLane[] = [
    {
        id: "lane_0123456789abcdef0123456789abcdef",
        label: "Soul · Warm",
        genreWeights: { Soul: 0.8 },
        moodWeights: { Warm: 0.7 },
        strength: 0.9,
        contexts: { "evening:weekday": 0.8 },
        energyBand: "medium",
        hidden: false,
    },
];

const vocabulary: AgentMixVocabulary = {
    genres: ["Dancehall", "Soul"],
    moods: ["Warm", "Zen"],
};

function render(overrides: Partial<React.ComponentProps<typeof AgentMyMixEditor>> = {}) {
    return renderToStaticMarkup(
        <AgentMyMixEditor
            lanes={lanes}
            vocabulary={vocabulary}
            preferences={{ context: "evening:weekday" }}
            onChange={vi.fn()}
            onSave={vi.fn()}
            {...overrides}
        />,
    );
}

describe("AgentMyMixEditor", () => {
    it("renders catalog lanes, canonical additions, coarse context, and private coverage labels", () => {
        const html = render({
            preferences: { context: "evening:weekday", additions: [{ genre: "Dancehall" }] },
            coverage: {
                lanes: [{ id: lanes[0].id, label: "Soul · Warm", requested: 4, matched: 1 }],
            },
            canSave: true,
        });

        expect(html).toContain("Soul · Warm");
        expect(html).toContain("Tuned for Evening · weekdays");
        expect(html).toContain("Genre · Dancehall");
        expect(html).toContain("Only 1 of 4 picks matched Soul · Warm.");
        expect(html).toContain("Save boosted and added preferences for future recommendations.");
        expect(html).toContain("Save to Taste Memory");
        expect(html).not.toContain(lanes[0].id);
        expect(html).not.toMatch(/Listener Pro|Upgrade|purchase/i);
    });

    it("keeps save disabled when no additions or boosted lanes need saving", () => {
        const html = render();
        expect(html).toMatch(/<button type="button" disabled="">Save to Taste Memory<\/button>/);
    });

    it("shows only coarse lane labels and no coverage block when coverage is absent", () => {
        const html = render({ coverage: null });
        expect(html).toContain("Evening · weekdays");
        expect(html).not.toContain("My Mix availability");
    });
});
