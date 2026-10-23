import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TrackDescriptor } from "../../lib/api";
import { TrackDescriptorTags, trackDescriptorTagLabels } from "./TrackDescriptorTags";

const descriptor: TrackDescriptor = {
  families: ["african", "world"],
  familyLabels: ["African", "World"],
  subGenres: ["sahel blues"],
  tempoBand: "mid",
  energyBand: "low",
  vocal: "instrumental",
  source: "deterministic",
};

describe("TrackDescriptorTags", () => {
  it("shows families, styles and bands as plain read-only tags with the explanation line", () => {
    const html = renderToStaticMarkup(<TrackDescriptorTags descriptor={descriptor} />);
    for (const label of ["African", "World", "sahel blues", "Medium tempo", "Low energy", "Instrumental"]) {
      expect(html).toContain(`>${label}</li>`);
    }
    expect(html).toContain("Suggested by Resonate from your track&#x27;s details and sound");
    // Read-only: nothing to click, type into or save.
    expect(html).not.toMatch(/<(button|input|select|textarea|a)[\s>]/);
  });

  it("renders nothing without a descriptor or without any tag", () => {
    expect(renderToStaticMarkup(<TrackDescriptorTags descriptor={null} />)).toBe("");
    expect(renderToStaticMarkup(<TrackDescriptorTags />)).toBe("");
    expect(
      renderToStaticMarkup(
        <TrackDescriptorTags
          descriptor={{ ...descriptor, familyLabels: [], families: [], subGenres: [], tempoBand: null, energyBand: null, vocal: null }}
        />,
      ),
    ).toBe("");
  });

  it("escapes tag text instead of rendering markup", () => {
    const html = renderToStaticMarkup(
      <TrackDescriptorTags descriptor={{ ...descriptor, subGenres: ["<img src=x onerror=alert(1)>"] }} />,
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("orders labels families, styles, then sound", () => {
    expect(trackDescriptorTagLabels(descriptor)).toEqual([
      "African",
      "World",
      "sahel blues",
      "Medium tempo",
      "Low energy",
      "Instrumental",
    ]);
  });
});
