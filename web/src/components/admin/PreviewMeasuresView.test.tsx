import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PreviewMeasuresView } from "./PreviewMeasuresView";
import type { PreviewMeasures } from "../../lib/previewMeasures";

const data: PreviewMeasures = {
  period: { from: "2031-03-03T00:00:00.000Z", to: "2031-03-17T00:00:00.000Z" },
  generatedAt: "2031-05-01T00:00:00.000Z",
  minimumGroup: 5,
  artists: { invited: 6, publishedWithin14Days: 5, stillWithin14Days: 0, share: 83.3 },
  listeners: {
    joined: 7,
    consenting: 6,
    analyticsAvailable: true,
    weeks: [{ week: 1, eligible: 6, active: null, share: null }],
  },
  features: {
    weeks: [{ start: "2031-03-03T00:00:00.000Z", end: "2031-03-10T00:00:00.000Z" }],
    rows: [
      { key: "aiDj", label: "AI DJ sessions started", recorded: true, weekly: [5] },
      { key: "stemPreviews", label: "Stem previews", recorded: false, weekly: [0] },
    ],
  },
  support: { opened: 6, answered: 5, medianHoursToAnswer: 6 },
  safety: { uploadsRefusedByLimit: null, takedownReports: 0, communityReports: 0 },
};

describe("PreviewMeasuresView (#2670)", () => {
  it("renders every figure, with hidden small groups in words", () => {
    const html = renderToStaticMarkup(<PreviewMeasuresView data={data} />);
    expect(html).toContain("5 (83.3%)");
    expect(html).toContain("Week of 3 Mar");
    expect(html).toContain("fewer than five");
    expect(html).toContain("not shown (small group)");
    expect(html).toContain("Not recorded yet");
    expect(html).toContain("6 hours");
    expect(html).toContain("accounts that allowed product analytics only");
  });
});
