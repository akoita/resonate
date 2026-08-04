import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  HomeReleaseArtwork,
  shouldOptimizeHomeReleaseArtwork,
  type HomeReleaseArtworkProps,
} from "./HomeReleaseArtwork";

describe("HomeReleaseArtwork", () => {
  it("renders the canonical public release artwork with responsive lazy-image metadata", () => {
    const html = renderToStaticMarkup(
      <span style={{ position: "relative", display: "block", width: 200, height: 200 }}>
        <HomeReleaseArtwork
          releaseId="rel_1"
          mimeType=" Image/JPEG; charset=binary "
          alt="Release cover"
          sizes="(max-width: 767px) 96px, 112px"
          className="custom-art"
        />
      </span>,
    );

    expect(html).toContain("%2Fcatalog%2Freleases%2Frel_1%2Fartwork");
    expect(html).toContain('alt="Release cover"');
    expect(html).toContain('sizes="(max-width: 767px) 96px, 112px"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('class="ng-home-release-artwork custom-art"');
    expect(html).not.toContain('fetchPriority="high"');
    expect(shouldOptimizeHomeReleaseArtwork("image/jpeg")).toBe(true);
    expect(shouldOptimizeHomeReleaseArtwork("IMAGE/AVIF; version=1")).toBe(true);
  });

  it.each(["image/svg+xml", "application/octet-stream"])(
    "bypasses optimization for historical or unknown MIME type %s",
    (mimeType) => {
      const html = renderToStaticMarkup(
        <HomeReleaseArtwork
          releaseId="rel_legacy"
          mimeType={mimeType}
          alt="Legacy artwork"
          sizes="64px"
        />,
      );

      expect(html).toContain('src="http://localhost:3000/catalog/releases/rel_legacy/artwork"');
      expect(html).not.toContain("/_next/image");
      expect(html).not.toContain("srcset=");
      expect(shouldOptimizeHomeReleaseArtwork(mimeType)).toBe(false);
    },
  );

  it("does not expose or honor an arbitrary src prop", () => {
    type AcceptsSrc = "src" extends keyof HomeReleaseArtworkProps ? true : false;
    const acceptsSrc: AcceptsSrc = false;
    const unsafeProps = {
      releaseId: "rel_safe",
      mimeType: "image/png",
      alt: "Safe artwork",
      sizes: "64px",
      src: "https://evil.example/artwork.jpg",
    } as HomeReleaseArtworkProps & { src: string };

    const html = renderToStaticMarkup(<HomeReleaseArtwork {...unsafeProps} />);

    expect(acceptsSrc).toBe(false);
    expect(html).toContain("%2Fcatalog%2Freleases%2Frel_safe%2Fartwork");
    expect(html).not.toContain("evil.example");
  });
});
