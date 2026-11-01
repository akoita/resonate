import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ClearQueueButtonView } from "./ClearQueueButton";

const noop = () => undefined;

describe("ClearQueueButtonView", () => {
  it("is hidden when only the playing track is queued", () => {
    expect(renderToStaticMarkup(<ClearQueueButtonView clearableCount={0} undoCount={null} onClear={noop} onUndo={noop} />)).toBe("");
  });

  it("shows the chip when there are tracks to clear", () => {
    const html = renderToStaticMarkup(<ClearQueueButtonView clearableCount={8} undoCount={null} onClear={noop} onUndo={noop} />);
    expect(html).toContain("Clear queue");
    expect(html).toContain("player-action-chip");
    expect(html).not.toContain("Undo");
  });

  it("offers Undo with the number of tracks taken out", () => {
    const html = renderToStaticMarkup(<ClearQueueButtonView clearableCount={0} undoCount={8} onClear={noop} onUndo={noop} />);
    expect(html).toContain("Cleared 8 tracks from the queue.");
    expect(html).toContain('role="status"');
    expect(html).toContain(">Undo</button>");
    expect(html).not.toContain("Clear queue</button>");
  });

  it("uses the singular for one track", () => {
    expect(renderToStaticMarkup(<ClearQueueButtonView clearableCount={0} undoCount={1} onClear={noop} onUndo={noop} />)).toContain("Cleared 1 track from");
  });
});
