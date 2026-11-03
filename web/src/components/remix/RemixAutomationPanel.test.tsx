import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { RemixAutomation } from "../../lib/api";
import { RemixAutomationPanel, barAtTime, curveBarAt, curveValueAt } from "./RemixAutomationPanel";

const noop = () => undefined;
const downbeats = Array.from({ length: 32 }, (_, i) => i * 2);
const stems = [
  { stemId: "bass", label: "Bass" },
  { stemId: "vocals", label: "Vocals" },
];
const lanes: RemixAutomation = {
  schemaVersion: "remix-automation/v1",
  stems: {
    bass: {
      level: [
        { bar: 0, value: -24 },
        { bar: 4, value: 0 },
      ],
    },
    vocals: { filter: [{ bar: 8, value: -0.5 }] },
  },
};
const base = {
  stems,
  downbeats,
  getPositionSec: () => 0,
  onChange: noop,
  onSave: noop,
  onUndo: noop,
};

describe("RemixAutomationPanel (#2541)", () => {
  it("lists the selected lane's points and what is automated", () => {
    const html = renderToStaticMarkup(<RemixAutomationPanel {...base} draft={lanes} saved={lanes} />);
    expect(html).toContain('aria-label="Automation lanes"');
    expect(html).toContain("-24.0 dB");
    expect(html).toContain(">0.0 dB<");
    expect(html).toContain("Automated: Bass (level) · Vocals (filter).");
    expect(html).toContain('aria-label="Level lane: 2 points"');
    // Saved and unchanged: nothing to save.
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Save automation/);
  });

  it("enables saving a changed draft and offers undo", () => {
    const html = renderToStaticMarkup(<RemixAutomationPanel {...base} draft={lanes} saved={null} />);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Save automation/);
    expect(html).toContain("Undo changes");
  });

  it("says when there is no bar grid", () => {
    const html = renderToStaticMarkup(
      <RemixAutomationPanel {...base} downbeats={[0]} draft={lanes} saved={null} />,
    );
    expect(html).toContain("no bar grid");
  });

  it("finds the bar under the playhead", () => {
    expect(barAtTime(downbeats, 0)).toBe(0);
    expect(barAtTime(downbeats, 5.9)).toBe(2);
    expect(barAtTime(downbeats, 6)).toBe(3);
    expect(barAtTime(downbeats, 999)).toBe(31);
  });

  it("maps a spot on the lane to a whole bar and a snapped value (#2551)", () => {
    expect(curveBarAt(0, 32)).toBe(0);
    expect(curveBarAt(1, 32)).toBe(31);
    expect(curveBarAt(0.5, 32)).toBe(16);
    expect(curveBarAt(-0.2, 32)).toBe(0);
    expect(curveBarAt(1.4, 32)).toBe(31);
    expect(curveValueAt(0, "level")).toBe(6);
    expect(curveValueAt(1, "level")).toBe(-24);
    expect(curveValueAt(0.5, "level")).toBe(-9);
    expect(curveValueAt(0.5, "filter")).toBe(0);
    expect(curveValueAt(2, "filter")).toBe(-1);
  });

  it("renders each point as a keyboard slider on the lane (#2551)", () => {
    const html = renderToStaticMarkup(<RemixAutomationPanel {...base} draft={lanes} saved={lanes} />);
    expect(html).toContain('role="group" aria-label="Level lane: 2 points"');
    expect(html).toContain('aria-label="Level point at bar 1"');
    expect(html).toContain('aria-label="Level point at bar 5"');
  });
});
