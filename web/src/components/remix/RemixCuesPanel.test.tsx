import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RemixCuesPanel } from "./RemixCuesPanel";

const noop = () => undefined;
const downbeats = Array.from({ length: 40 }, (_, i) => i * 2);
const base = {
  downbeats,
  barSec: 2,
  endSec: 80,
  looping: null,
  onSave: noop,
  onLoop: noop,
  dj: { enabled: false, reason: "Set an intro or outro loop first.", busy: false, onExport: noop },
};

describe("RemixCuesPanel (#2540)", () => {
  it("shows saved loops with their length and what the DJ version adds", () => {
    const html = renderToStaticMarkup(
      <RemixCuesPanel
        {...base}
        saved={{
          schemaVersion: "remix-cues/v1",
          intro: { startBar: 0, bars: 8, repeats: 2 },
          outro: null,
        }}
        dj={{ enabled: true, reason: null, busy: false, onExport: noop }}
      />,
    );
    expect(html).toContain("bars 1–8 · 16.0 s · adds 32.0 s");
    expect(html).toContain('aria-label="Intro loop"');
    expect(html).toContain("Export DJ version");
    expect(html).not.toContain("Set an intro or outro loop first.");
  });

  it("says why the DJ version is unavailable", () => {
    const html = renderToStaticMarkup(<RemixCuesPanel {...base} saved={null} />);
    expect(html).toContain("Set an intro or outro loop first.");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Export DJ version/);
  });

  it("explains a source without bars", () => {
    const html = renderToStaticMarkup(<RemixCuesPanel {...base} downbeats={[]} saved={null} />);
    expect(html).toContain("no bar grid");
  });
});
