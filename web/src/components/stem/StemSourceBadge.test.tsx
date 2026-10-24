import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StemSourceBadge } from "./StemSourceBadge";

describe("StemSourceBadge (#1976)", () => {
  it("shows Official for the artist's lossless stems", () => {
    const html = renderToStaticMarkup(<StemSourceBadge source="official" />);
    expect(html).toContain(">Official<");
    expect(html).toContain('data-source="official"');
    expect(html).toContain("Lossless audio uploaded by the artist");
  });

  it("shows Separated (AI) with the model in its tooltip", () => {
    const html = renderToStaticMarkup(<StemSourceBadge source="separated" separationModel="demucs-htdemucs-6s" />);
    expect(html).toContain(">Separated (AI)<");
    expect(html).toContain("Model: demucs-htdemucs-6s.");
  });

  it("renders nothing for a full-mix row", () => {
    expect(renderToStaticMarkup(<StemSourceBadge source={null} />)).toBe("");
  });
});
