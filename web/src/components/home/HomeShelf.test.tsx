/**
 * Home v3 shelf chrome — header content, action link, per-tile wrapping, and
 * the no-dead-buttons contract: the scroll arrows are hidden in server markup
 * until a client measurement proves the row overflows.
 */
import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HomeShelf } from "./HomeShelf";

describe("HomeShelf", () => {
  it("renders the kicker, title, description, meta, and action link", () => {
    const html = renderToStaticMarkup(
      <HomeShelf
        kicker="What listeners play"
        kickerTone="tertiary"
        title="Trending Now"
        description="Ranked by real listening."
        meta={<span className="ng-shelf__meta">Last 7 days</span>}
        action={{ href: "/catalog", label: "Browse catalog" }}
        testId="shelf"
        railKind="exploration"
      >
        <span>One</span>
        <span>Two</span>
      </HomeShelf>,
    );
    expect(html).toContain('class="ng-kicker ng-kicker--tertiary"');
    expect(html).toContain('<h3 class="ng-section-title">Trending Now</h3>');
    expect(html).toContain("Ranked by real listening.");
    expect(html).toContain("Last 7 days");
    expect(html).toContain('href="/catalog"');
    expect(html).toContain("Browse catalog");
    expect(html).toContain('data-testid="shelf"');
    expect(html).toContain('data-rail-kind="exploration"');
    expect(html.match(/class="ng-shelf__item"/g)).toHaveLength(2);
  });

  it("keeps the scroll arrows hidden in server markup (no dead buttons)", () => {
    const html = renderToStaticMarkup(
      <HomeShelf kicker="Kicker" title="Stem Lab">
        <span>Only tile</span>
      </HomeShelf>,
    );
    expect(html).toMatch(/<div class="ng-shelf__navs" hidden="">/);
    expect(html).toContain('aria-label="Scroll Stem Lab back"');
    expect(html).toContain('aria-label="Scroll Stem Lab forward"');
    // No overflow measured yet, so no edge fades either.
    expect(html).not.toContain("data-fade-start");
    expect(html).not.toContain("data-fade-end");
  });

  it("exposes the desktop and phone item widths as custom properties", () => {
    const html = renderToStaticMarkup(
      <HomeShelf kicker="Kicker" title="Drops" itemWidth={280}>
        <span>Tile</span>
      </HomeShelf>,
    );
    expect(html).toContain("--shelf-item:280px");
    // Phone = 78% of the desktop width, never below 148px.
    expect(html).toContain("--shelf-item-phone:218px");

    const narrow = renderToStaticMarkup(
      <HomeShelf kicker="Kicker" title="Artists" itemWidth={148}>
        <span>Tile</span>
      </HomeShelf>,
    );
    expect(narrow).toContain("--shelf-item-phone:148px");
  });

  it("omits the action link when none is given", () => {
    const html = renderToStaticMarkup(
      <HomeShelf kicker="Kicker" title="Plain">
        <span>Tile</span>
      </HomeShelf>,
    );
    expect(html).not.toContain("ng-section-link");
  });
});
