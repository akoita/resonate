import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DjSet } from "../../lib/agentDjSet";
import { PlayerDjQueueHeaderView, isDjSetTrack, queueHoldsDjSet } from "./PlayerDjQueueHeader";

const SET: DjSet = {
    sessionId: "s-1",
    preferences: {
        request: { genres: ["world music", "afrobeats"], moods: [], energy: null, bpm: null },
        requestText: "my private sentence",
    },
    trackIds: ["cat-1", "cat-2"],
};

const queue = [{ id: "local-1", catalogTrackId: "cat-1" }, { id: "cat-9" }];

describe("PlayerDjQueueHeaderView (#2312)", () => {
    it("is hidden without a set", () => {
        expect(renderToStaticMarkup(<PlayerDjQueueHeaderView set={null} queue={queue} />)).toBe("");
    });

    it("is hidden when no queued track belongs to the set", () => {
        expect(renderToStaticMarkup(<PlayerDjQueueHeaderView set={SET} queue={[{ id: "cat-9" }]} />)).toBe("");
        expect(renderToStaticMarkup(<PlayerDjQueueHeaderView set={SET} queue={[]} />)).toBe("");
    });

    it("shows the summary and a Steer link to the AI DJ section", () => {
        const html = renderToStaticMarkup(<PlayerDjQueueHeaderView set={SET} queue={queue} />);
        expect(html).toContain("AI DJ");
        expect(html).toContain("World music · Afrobeats");
        expect(html).toContain('href="/#ai-dj"');
        expect(html).toContain('aria-label="Steer the AI DJ"');
        expect(html).toContain("Now &amp; Up next");
    });

    it("never shows the typed sentence", () => {
        expect(renderToStaticMarkup(<PlayerDjQueueHeaderView set={SET} queue={queue} />)).not.toContain("private sentence");
    });
});

describe("DJ set membership of queue rows", () => {
    it("matches by catalog id, falling back to the track id", () => {
        expect(isDjSetTrack(SET, { id: "local-1", catalogTrackId: "cat-1" })).toBe(true);
        expect(isDjSetTrack(SET, { id: "cat-2" })).toBe(true);
        expect(isDjSetTrack(SET, { id: "cat-1", catalogTrackId: "other" })).toBe(false);
        expect(isDjSetTrack(null, { id: "cat-1" })).toBe(false);
        expect(queueHoldsDjSet(SET, queue)).toBe(true);
        expect(queueHoldsDjSet(null, queue)).toBe(false);
    });
});
