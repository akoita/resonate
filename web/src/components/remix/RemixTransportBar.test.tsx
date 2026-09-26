import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  formatTransportClock,
  RemixTransportBar,
  type RemixTransportBarProps,
} from "./RemixTransportBar";

const noop = () => undefined;

function render(overrides: Partial<RemixTransportBarProps> = {}): string {
  return renderToStaticMarkup(
    <RemixTransportBar
      status="idle"
      getPositionSec={() => null}
      durationSec={185}
      source={{ kind: "arrangement" }}
      hasOriginal={false}
      hasDraft={false}
      loopLabel={null}
      meter={<span className="test-meter">meter</span>}
      onToggle={noop}
      onSourceChange={noop}
      onClearLoop={noop}
      {...overrides}
    />,
  );
}

describe("formatTransportClock", () => {
  it("formats seconds as m:ss", () => {
    expect(formatTransportClock(0)).toBe("0:00");
    expect(formatTransportClock(65.9)).toBe("1:05");
    expect(formatTransportClock(185)).toBe("3:05");
  });

  it("shows a placeholder for unknown values", () => {
    expect(formatTransportClock(null)).toBe("–:––");
    expect(formatTransportClock(Number.NaN)).toBe("–:––");
    expect(formatTransportClock(-1)).toBe("–:––");
  });
});

describe("RemixTransportBar", () => {
  it("renders a sticky bar with a Play button, clock, and meter slot", () => {
    const html = render();
    expect(html).toContain("sticky top-0 z-10");
    expect(html).toContain('aria-label="Play"');
    expect(html).toContain("0:00 / 3:05");
    expect(html).toContain("test-meter");
  });

  it("shows Stop while playing and a spinner while loading", () => {
    expect(render({ status: "playing" })).toContain('aria-label="Stop"');
    const loading = render({ status: "loading" });
    expect(loading).toContain("remix-transport-spinner");
    expect(loading).toContain('aria-busy="true"');
  });

  it("hides the source switch when only the arrangement is available", () => {
    const html = render();
    expect(html).not.toContain("remix-transport-source");
  });

  it("renders only the available sources", () => {
    const withOriginal = render({ hasOriginal: true });
    expect(withOriginal).toContain(">Arrangement</button>");
    expect(withOriginal).toContain(">Original</button>");
    expect(withOriginal).not.toContain(">Draft</button>");

    const withDraft = render({ hasDraft: true });
    expect(withDraft).toContain(">Draft</button>");
    expect(withDraft).not.toContain(">Original</button>");
  });

  it("marks the active source as pressed", () => {
    const html = render({
      hasOriginal: true,
      hasDraft: true,
      source: { kind: "draft", jobId: "job-1" },
    });
    expect(html).toMatch(/aria-pressed="true"[^>]*>Draft<\/button>/);
    expect(html).toMatch(/aria-pressed="false"[^>]*>Arrangement<\/button>/);
    expect(html).toMatch(/aria-pressed="false"[^>]*>Original<\/button>/);
  });

  it("shows the loop chip with a clear button only when looping", () => {
    expect(render()).not.toContain("remix-transport-loop");
    const html = render({ loopLabel: "Looping bar 9" });
    expect(html).toContain("Looping bar 9");
    expect(html).toContain('aria-label="Clear loop"');
  });

  it("shows a placeholder duration when it is unknown", () => {
    expect(render({ durationSec: null })).toContain("0:00 / –:––");
  });

  it("has no volume control unless the editor provides one", () => {
    expect(render()).not.toContain("remix-transport-volume");
  });

  it("renders the listening volume with a speaker mute toggle (#1910)", () => {
    const html = render({
      volume: {
        value: { level: 0.5, muted: false },
        onLevelChange: noop,
        onToggleMute: noop,
      },
    });
    expect(html).toContain('aria-label="Volume"');
    expect(html).toContain('type="range"');
    expect(html).toContain('value="50"');
    expect(html).toContain('aria-valuetext="50%"');
    expect(html).toContain("not saved to your remix");
    expect(html).toMatch(/<button[^>]*aria-label="Mute"[^>]*bg-transparent/);
    expect(html).toContain('aria-pressed="false"');
  });

  it("shows the slider at zero and offers Unmute while muted", () => {
    const html = render({
      volume: {
        value: { level: 0.8, muted: true },
        onLevelChange: noop,
        onToggleMute: noop,
      },
    });
    expect(html).toContain('aria-label="Unmute"');
    expect(html).toContain('value="0"');
    expect(html).toContain('aria-valuetext="Muted"');
  });
});
