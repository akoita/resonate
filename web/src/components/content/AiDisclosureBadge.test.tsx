import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AiDisclosureBadge } from "./AiDisclosureBadge";

describe("AiDisclosureBadge", () => {
  it.each([
    ["partly" as const, "AI-assisted"],
    ["all" as const, "AI-generated"],
    ["undeclared" as const, "AI disclosure unavailable"],
  ])("renders the honest label for %s", (level, label) => {
    const html = renderToStaticMarkup(
      <AiDisclosureBadge disclosure={{ level, facets: [] }} />,
    );

    expect(html).toContain(label);
    expect(html).toContain(`aria-label="AI disclosure: ${label}"`);
  });

  it("treats missing disclosure as unavailable, not human-made", () => {
    const html = renderToStaticMarkup(<AiDisclosureBadge />);

    expect(html).toContain("AI disclosure unavailable");
    expect(html).not.toContain("Human-made");
  });

  it("hides a human-made declaration unless explicitly requested", () => {
    const disclosure = {
      level: "none" as const,
      facets: [],
    };

    expect(renderToStaticMarkup(<AiDisclosureBadge disclosure={disclosure} />)).toBe("");
    expect(
      renderToStaticMarkup(
        <AiDisclosureBadge disclosure={disclosure} showHumanMade />,
      ),
    ).toContain("Human-made");
  });
  describe("catalog attestation (#2252)", () => {
    const attested = {
      level: "none" as const,
      containsAI: "None" as const,
      facets: [],
      source: "catalog_attestation" as const,
    };
    const unattested = {
      level: "undeclared" as const,
      containsAI: null,
      facets: [],
      source: "migration" as const,
    };

    it("no longer shows the unavailable pill for an attested track", () => {
      const html = renderToStaticMarkup(<AiDisclosureBadge disclosure={attested} />);

      expect(html).toBe("");
      expect(html).not.toContain("AI disclosure unavailable");
    });

    it("still shows the unavailable pill for an unattested legacy track", () => {
      expect(
        renderToStaticMarkup(<AiDisclosureBadge disclosure={unattested} />),
      ).toContain("AI disclosure unavailable");
    });

    it("words the human-made tooltip as a Resonate attestation, not an uploader declaration", () => {
      const html = renderToStaticMarkup(
        <AiDisclosureBadge disclosure={attested} showHumanMade />,
      );

      expect(html).toContain("Human-made");
      expect(html).toContain(
        "Resonate identified this recording as a published human-made work.",
      );
      expect(html).not.toContain("The uploader declared");
    });

    it("keeps the uploader wording for an artist human-made declaration", () => {
      const html = renderToStaticMarkup(
        <AiDisclosureBadge
          disclosure={{ level: "none", facets: [], source: "artist" }}
          showHumanMade
        />,
      );

      expect(html).toContain("The uploader declared that this music contains no AI contribution.");
    });
  });
});
