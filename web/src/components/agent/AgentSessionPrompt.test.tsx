import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AgentSessionRequest } from "../../lib/api";
import AgentSessionPrompt from "./AgentSessionPrompt";
import { SESSION_PRESETS } from "./AgentSessionPresets";

const request: AgentSessionRequest = {
  genres: ["deep house"],
  moods: ["warm"],
  energy: "medium",
  bpm: { min: 120, max: 125 },
};

function render(props: Partial<React.ComponentProps<typeof AgentSessionPrompt>> = {}) {
  return renderToStaticMarkup(
    <AgentSessionPrompt
      text=""
      onTextChange={vi.fn()}
      onSelectPreset={vi.fn()}
      request={null}
      onRemoveChip={vi.fn()}
      onEnergyChange={vi.fn()}
      onSubmit={vi.fn()}
      {...props}
    />,
  );
}

describe("AgentSessionPrompt", () => {
  it("asks what the session is for with a limited textarea and an example", () => {
    const html = render();
    expect(html).toContain("What&#x27;s this session for?");
    expect(html).toContain("<textarea");
    expect(html).toContain('maxLength="500"');
    expect(html).toContain("Warm deep house around 122 BPM for cooking");
    expect(html).toContain("not saved");
    expect(html).toContain("Start session");
    expect(html).toContain("No filters yet");
  });

  it("shows the five presets as quick-start chips and marks the active one", () => {
    const html = render({ activePresetIntent: "Hype" });
    for (const preset of SESSION_PRESETS) expect(html).toContain(preset.name);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(SESSION_PRESETS.length - 1);
    expect(html).toMatch(/aria-pressed="true"[^>]*>Pulse Raid</);
  });

  it("renders each parsed filter as a removable chip and energy as a select", () => {
    const html = render({ request });
    expect(html).toContain("Deep house");
    expect(html).toContain("Warm mood");
    expect(html).toContain("120–125 BPM");
    expect(html).toContain('aria-label="Remove filter Deep house"');
    expect(html).toContain('aria-label="Remove filter Warm mood"');
    expect(html).toContain('aria-label="Remove filter Medium energy"');
    expect(html).toContain('aria-label="Remove filter 120–125 BPM"');
    expect(html).toContain("<select");
    expect(html).toMatch(/<option value="medium" selected="">medium<\/option>/);
    expect(html).toContain('<option value="low">low</option>');
    expect(html).toContain('<option value="high">high</option>');
    expect(html).not.toContain("No filters yet");
  });

  it("lists phrases it did not catch and filters not used for listening", () => {
    const html = render({
      request,
      unparsed: ["for cooking", "with feeling"],
      ignored: ["keys", "maxTotalUsd", "maxPerItemUsd", "verifiedHumanOnly"],
    });
    expect(html).toContain("Didn&#x27;t catch: “for cooking”, “with feeling”");
    expect(html).toContain("Not used for listening: key, price, verified human only");
  });

  it("omits the notes when there is nothing to say", () => {
    const html = render({ request });
    expect(html).not.toContain("Didn&#x27;t catch");
    expect(html).not.toContain("Not used for listening");
  });

  it("explains coverage gaps in the request's own words", () => {
    const html = render({
      request,
      coverage: { picks: 5, gaps: [{ filter: "bpm", matched: 1 }] },
    });
    expect(html).toContain("Only 1 of 5 picks matched 120–125 BPM");
  });

  it("shows the reading and error states and blocks the action while reading", () => {
    const reading = render({ isParsing: true });
    expect(reading).toContain("Reading what you wrote");
    expect(reading).toMatch(/<button[^>]*disabled=""[^>]*>Reading…<\/button>/);

    const failed = render({ request, parseError: "Couldn't read that just now. Your filters are unchanged." });
    expect(failed).toContain("Couldn&#x27;t read that just now");
    expect(failed).toContain("Deep house");
  });

  it("offers Update session while a session is live", () => {
    expect(render({ isLive: true })).toContain("Update session");
    expect(render({ isLive: true, isBusy: true })).toContain("Updating…");
    expect(render({ isBusy: true })).toContain("Starting…");
  });
});
