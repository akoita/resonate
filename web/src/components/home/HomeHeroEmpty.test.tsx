/**
 * Home hero loading + empty states (#1869): the skeleton makes no claims and
 * offers no actions; the empty state is honest and points at real routes.
 */
import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HomeHeroEmpty, HomeHeroSkeleton } from "./HomeHeroEmpty";

/** Visible text only: tags stripped, entities for apostrophes decoded. */
function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

describe("HomeHeroSkeleton", () => {
  const html = renderToStaticMarkup(<HomeHeroSkeleton />);

  it("reserves the approved hero frame while busy", () => {
    expect(html).toMatch(/^<div class="ng-hero ng-hero--loading"/);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('class="ng-hero__motif"');
  });

  it("makes no text claims and offers no rail, image or CTAs", () => {
    expect(textOf(html)).toBe("");
    expect(html).not.toMatch(/<a\b|<button\b|<img\b/);
    expect(html).not.toContain("ng-hero__campaign-rail");
  });
});

describe("HomeHeroEmpty", () => {
  const html = renderToStaticMarkup(<HomeHeroEmpty />);
  const text = textOf(html);

  it("renders an honest Resonate Shows invitation in the hero frame", () => {
    expect(html).toMatch(/^<div class="ng-hero ng-hero--empty"/);
    expect(html).toMatch(/<span class="ng-kicker ng-kicker--primary">Resonate Shows<\/span>/);
    expect(html).toMatch(/<h2 class="ng-hero__title">Fans bring the show\.<\/h2>/);
    expect(text).toContain("No campaigns are open for pledges right now.");
    expect(text).toMatch(/propose a show for an artist in their city/);
    expect(text).toMatch(/held in escrow and refunded automatically if the show doesn't happen/);
  });

  it("shows no image and no campaign-specific claims", () => {
    expect(html).not.toMatch(/<img\b/);
    expect(html).not.toContain("ng-hero__campaign-rail");
    expect(text).not.toMatch(/Featured Campaign|Back This Show|% funded/i);
  });

  it("offers Start a campaign and Browse shows actions to real routes", () => {
    const links = Array.from(html.matchAll(/<a\b([^>]*)>(.*?)<\/a>/g)).map(([, attrs, inner]) => ({
      href: /href="([^"]+)"/.exec(attrs)?.[1],
      className: /class="([^"]+)"/.exec(attrs)?.[1],
      text: textOf(inner),
    }));

    expect(links).toEqual([
      { href: "/shows/create", className: "ng-btn ng-btn--primary", text: "rocket_launch Start a campaign" },
      { href: "/shows", className: "ng-btn ng-btn--glass", text: "Browse shows" },
    ]);
  });
});
