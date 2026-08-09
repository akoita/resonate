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
});
