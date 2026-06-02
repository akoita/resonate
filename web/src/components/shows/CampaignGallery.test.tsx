import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CampaignGallery } from "./CampaignGallery";

const visuals = [
  { id: "v1", url: "https://example.com/one.jpg", caption: "Backstage" },
  { id: "v2", url: "https://example.com/two.jpg" },
  { id: "v3", url: "https://example.com/three.jpg" },
];

describe("CampaignGallery", () => {
  it("renders a gallery wall with one open-button per visual", () => {
    const html = renderToStaticMarkup(<CampaignGallery visuals={visuals} />);
    expect(html).toContain("show-detail__visual-story");
    expect((html.match(/show-detail__visual-open/g) ?? []).length).toBe(3);
    // Captioned visual uses its caption in the label; caption-less ones fall
    // back to a positional label.
    expect(html).toContain("Open: Backstage");
    expect(html).toContain("Open image 2");
    expect(html).toContain("https://example.com/one.jpg");
  });

  it("keeps the immersive lightbox closed until a visual is opened", () => {
    const html = renderToStaticMarkup(<CampaignGallery visuals={visuals} />);
    // Lightbox is portal-rendered only after a click, so the initial
    // server markup must not contain it.
    expect(html).not.toContain("gallery-lightbox");
  });
});
