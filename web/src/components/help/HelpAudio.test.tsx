import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { getArticle } from "../../lib/help";
import type { HelpBlock } from "../../lib/help/types";
import { HelpBlocks } from "./HelpBlocks";

const AUDIO_BLOCK: HelpBlock = {
  kind: "audio",
  src: "/help/audio/remix-demo-slowed-reverb.mp3",
  caption: "After: the Slowed + reverb vibe",
  description: "Slower and lower in pitch, with a roomy reverb that rings on after the beat.",
  duration: 15.4,
};

describe("audio examples in the User Guide (#1943)", () => {
  it("renders an accessible player with the caption and a visible description", () => {
    const html = renderToStaticMarkup(<HelpBlocks blocks={[AUDIO_BLOCK]} />);
    expect(html).toContain('<audio class="help-audio__player" controls="" preload="none"');
    expect(html).toContain('src="/help/audio/remix-demo-slowed-reverb.mp3"');
    expect(html).toContain("After: the Slowed + reverb vibe");
    expect(html).toContain("0:15");
    // Visible text alternative, wired to the player.
    expect(html).toContain("Slower and lower in pitch, with a roomy reverb that rings on after the beat.");
    const describedBy = /aria-describedby="([^"]+)"/.exec(html)?.[1];
    const labelledBy = /aria-labelledby="([^"]+)"/.exec(html)?.[1];
    expect(describedBy && html.includes(`id="${describedBy}"`)).toBe(true);
    expect(labelledBy && html.includes(`id="${labelledBy}"`)).toBe(true);
    // Nothing downloads until the reader presses play.
    expect(html).not.toContain("autoplay");
  });

  it("puts the four Remix Studio examples in the guide's levels they belong to", () => {
    const remix = getArticle("remix-studio")!;
    const audioBySection = new Map<string, string[]>();
    for (const section of remix.sections) {
      const files = section.blocks.flatMap((block) => (block.kind === "audio" ? [block.src] : []));
      if (files.length > 0) audioBySection.set(section.id, files);
    }
    expect(audioBySection.get("first-remix")).toEqual([
      "/help/audio/remix-demo-original.mp3",
      "/help/audio/remix-demo-slowed-reverb.mp3",
    ]);
    expect(audioBySection.get("stem-effects")).toContain("/help/audio/remix-demo-vocal-echo.mp3");
    expect(audioBySection.get("arrangements-and-shape")).toEqual(["/help/audio/remix-demo-short-edit.mp3"]);
    expect(audioBySection.get("ai-part")).toEqual(["/help/audio/remix-demo-ai-bass.mp3"]);
  });

  it("never presents the stub bass example as a real AI model", () => {
    const remix = getArticle("remix-studio")!;
    const ai = remix.sections.find((section) => section.id === "ai-part")!;
    const block = ai.blocks.find((b) => b.kind === "audio");
    const description = block && block.kind === "audio" ? block.description.toLowerCase() : "";
    expect(description).toContain("not a real ai model");
  });
});
