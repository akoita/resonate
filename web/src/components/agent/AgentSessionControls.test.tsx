import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import AgentCommandBar from "./AgentCommandBar";
import AgentSessionPrompt from "./AgentSessionPrompt";

/** The command bar and the prompt as the AI DJ page renders them together. */
function page(isLive: boolean) {
  return renderToStaticMarkup(
    <>
      <AgentCommandBar name="Night DJ" isLive={isLive} onStop={vi.fn()} />
      <AgentSessionPrompt
        text=""
        onTextChange={vi.fn()}
        onSelectPreset={vi.fn()}
        request={null}
        onRemoveChip={vi.fn()}
        onEnergyChange={vi.fn()}
        isLive={isLive}
        onSubmit={vi.fn()}
      />
    </>,
  );
}

function buttonLabels(html: string): string[] {
  return [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((match) =>
    // Keep only the text between tags (a label, not markup to sanitize).
    match[1].split(/<[^>]*>/).join("").trim(),
  );
}

describe("AI DJ session controls (#2237)", () => {
  it("offers exactly one control that starts a session while idle, and no Stop", () => {
    const labels = buttonLabels(page(false));
    expect(labels.filter((label) => /^start session$/i.test(label))).toHaveLength(1);
    expect(labels.filter((label) => /stop/i.test(label))).toHaveLength(0);
    expect(labels.filter((label) => /update session/i.test(label))).toHaveLength(0);
  });

  it("offers Update session and Stop, and no start control, while live", () => {
    const labels = buttonLabels(page(true));
    expect(labels.filter((label) => /^start session$/i.test(label))).toHaveLength(0);
    expect(labels.filter((label) => /^update session$/i.test(label))).toHaveLength(1);
    expect(labels.filter((label) => /^stop session$/i.test(label))).toHaveLength(1);
  });
});
