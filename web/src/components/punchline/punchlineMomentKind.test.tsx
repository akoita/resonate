import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PunchlineCollectibleCard } from "./PunchlineCollectibleCard";
import {
  MOMENT_KINDS,
  momentKindLabel,
  normalizeMomentKind,
} from "./punchlineMomentKind";

describe("moment kinds (#1476)", () => {
  it("offers Punchline, Crescendo, Hook and Solo, never Drop", () => {
    expect([...MOMENT_KINDS]).toEqual(["punchline", "crescendo", "hook", "solo"]);
    expect(MOMENT_KINDS.map(momentKindLabel)).not.toContain("Drop");
  });

  it("reads a missing or unknown kind as punchline", () => {
    expect(normalizeMomentKind(undefined)).toBe("punchline");
    expect(normalizeMomentKind("drop")).toBe("punchline");
    expect(normalizeMomentKind(" Crescendo ")).toBe("crescendo");
  });

  it("flavours the card with its kind", () => {
    const html = renderToStaticMarkup(
      <PunchlineCollectibleCard
        title="The swell"
        lyricText="Strings rise"
        durationMs={8000}
        editionSize={50}
        priceCents={0}
        rightsLabel="NON_COMMERCIAL_COLLECTIBLE"
        momentKind="crescendo"
      />,
    );
    expect(html).toContain('data-kind="crescendo"');
    expect(html).toContain("Crescendo");
  });

  it("labels an older moment with no kind as a punchline", () => {
    const html = renderToStaticMarkup(
      <PunchlineCollectibleCard
        title="Bar"
        lyricText="A line"
        durationMs={5000}
        editionSize={10}
        priceCents={0}
        rightsLabel="NON_COMMERCIAL_COLLECTIBLE"
      />,
    );
    expect(html).toContain('data-kind="punchline"');
    expect(html).toContain("Punchline");
  });
});
