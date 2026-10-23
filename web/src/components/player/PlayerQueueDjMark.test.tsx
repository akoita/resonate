import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OUTSIDE_REQUEST_LABEL, PlayerQueueDjMark, djPickLabel } from "./PlayerQueueDjMark";

describe("PlayerQueueDjMark (#2312)", () => {
    it("puts the pick's reason in the accessible name and hover text", () => {
        const html = renderToStaticMarkup(<PlayerQueueDjMark note={{ reason: "Sounds close to your taste", source: "ai" }} />);
        expect(html).toContain('aria-label="Picked by your AI DJ: Sounds close to your taste"');
        expect(html).toContain('title="Picked by your AI DJ: Sounds close to your taste"');
        expect(html).not.toContain(OUTSIDE_REQUEST_LABEL);
    });

    it("says only that the DJ picked it when there is no reason or no note", () => {
        expect(djPickLabel()).toBe("Picked by your AI DJ");
        expect(djPickLabel({ reason: "   " })).toBe("Picked by your AI DJ");
        expect(renderToStaticMarkup(<PlayerQueueDjMark />)).toContain('aria-label="Picked by your AI DJ"');
    });

    it("shows the muted outside-your-request mark only for matched === false", () => {
        const outside = renderToStaticMarkup(<PlayerQueueDjMark note={{ reason: "Filler", matched: false }} />);
        expect(outside).toContain(OUTSIDE_REQUEST_LABEL);
        expect(outside).toContain("doesn&#x27;t match your request&#x27;s filters");
        for (const note of [{ matched: true }, { reason: "No flag" }, undefined]) {
            expect(renderToStaticMarkup(<PlayerQueueDjMark note={note} />)).not.toContain(OUTSIDE_REQUEST_LABEL);
        }
    });
});
