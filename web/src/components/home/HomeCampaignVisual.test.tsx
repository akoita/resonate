import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  HomeCampaignVisual,
  shouldOptimizeHomeCampaignVisual,
} from "./HomeCampaignVisual";

describe("HomeCampaignVisual", () => {
  it("optimizes only the canonical API campaign visual route", () => {
    const src = "http://localhost:3000/shows/campaigns/campaign-1/visuals/card";
    const html = renderToStaticMarkup(
      <span style={{ position: "relative", display: "block", width: 400, height: 225 }}>
        <HomeCampaignVisual
          src={src}
          sizes="(max-width: 767px) 100vw, 50vw"
          className="custom-campaign-image"
        />
      </span>,
    );

    expect(shouldOptimizeHomeCampaignVisual(src)).toBe(true);
    expect(html).toContain("%2Fshows%2Fcampaigns%2Fcampaign-1%2Fvisuals%2Fcard");
    expect(html).toContain('sizes="(max-width: 767px) 100vw, 50vw"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('alt=""');
    expect(html).toContain('class="ng-home-campaign-visual custom-campaign-image"');
  });

  it("preloads the initial canonical hero visual", () => {
    const html = renderToStaticMarkup(
      <span style={{ position: "relative", display: "block", width: 800, height: 450 }}>
        <HomeCampaignVisual
          src="http://localhost:3000/shows/campaigns/campaign-1/visuals/hero"
          sizes="100vw"
          preload
        />
      </span>,
    );

    expect(html).toContain('<link rel="preload" as="image"');
    expect(html).not.toContain('loading="lazy"');
  });

  it("optimizes the server-versioned canonical visual path", () => {
    const src = "http://localhost:3000/shows/campaigns/campaign-1/visuals/card/v12";
    const html = renderToStaticMarkup(
      <span style={{ position: "relative", display: "block", width: 400, height: 225 }}>
        <HomeCampaignVisual src={src} sizes="100vw" />
      </span>,
    );

    expect(shouldOptimizeHomeCampaignVisual(src)).toBe(true);
    expect(html).toContain("%2Fshows%2Fcampaigns%2Fcampaign-1%2Fvisuals%2Fcard%2Fv12");
    expect(html).toContain("/_next/image");
  });

  it.each([
    "https://media.example.test/shows/campaigns/campaign-1/visuals/card",
    "http://user:password@localhost:3000/shows/campaigns/campaign-1/visuals/card",
    "http://localhost:3000/shows/campaigns/campaign-1/visuals/card?version=2",
    "http://localhost:3000/shows/campaigns/campaign-1/visuals/card#hero",
    "http://localhost:3000/shows/campaigns/campaign-1/visuals",
    "http://localhost:3000/shows/campaigns/campaign-1/visuals/card/extra",
    "http://localhost:3000/shows/campaigns/campaign-1/visuals/card/v0",
    "http://localhost:3000/shows/campaigns/campaign-1/visuals/card/v01",
    "http://localhost:3000/shows/campaigns/campaign-1/visuals/card/vnope",
    "/shows/sennarin-portrait.webp",
    "blob:campaign-art",
    "data:image/webp;base64,AAAA",
    "not a url",
  ])("keeps non-canonical source %s on the raw browser path", (src) => {
    expect(shouldOptimizeHomeCampaignVisual(src)).toBe(false);

    const html = renderToStaticMarkup(
      <HomeCampaignVisual src={src} sizes="320px" className="fallback-image" />,
    );

    expect(html).toContain(`<img src="${src.replaceAll("&", "&amp;")}`);
    expect(html).not.toContain("/_next/image");
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
  });
});
