import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../auth/AuthProvider", () => ({ useAuth: () => ({ token: null, sessionChecked: true }) }));
vi.mock("../ui/Toast", () => ({ useToast: () => ({ addToast: vi.fn() }) }));

import { CompositionEditor } from "./CompositionEditor";
import { CompositionSummary } from "./ReleaseCompositionSection";
import { EMPTY_COMPOSITION_DRAFT } from "../../lib/composition";

describe("CompositionEditor (#2669)", () => {
  it("renders labelled fields for each writer and the errors it is given", () => {
    const html = renderToStaticMarkup(
      <CompositionEditor
        idPrefix="t1"
        value={{
          ...EMPTY_COMPOSITION_DRAFT,
          writers: [{ name: "Ada", role: "lyricist", share: "50", society: "SACEM", ipi: "" }],
          coverOrSamples: true,
          coverNote: "A drum break",
        }}
        errors={{ writers: "Shares must add up to 100%. They add up to 50%.", iswc: "Use the form T-123.456.789-0." }}
        onChange={() => undefined}
      />,
    );
    expect(html).toContain("Writers");
    expect(html).toContain('value="Ada"');
    expect(html).toContain("Remove writer Ada");
    expect(html).toContain("Shares must add up to 100%");
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain("A drum break");
    expect(html).toContain("Add a writer");
  });

  it("hides the publisher field when self-published", () => {
    const html = renderToStaticMarkup(
      <CompositionEditor idPrefix="t2" value={{ ...EMPTY_COMPOSITION_DRAFT, selfPublished: true }} onChange={() => undefined} />,
    );
    expect(html).not.toContain(">Publisher<");
    expect(html).toContain("No writers listed yet.");
  });
});

describe("CompositionSummary", () => {
  it("shows the full details to the artist and operators", () => {
    const html = renderToStaticMarkup(
      <CompositionSummary
        composition={{
          writers: [{ name: "Ada", role: "composer", share: 100, society: "PRS", ipi: "123456789" }],
          publisher: null,
          selfPublished: true,
          iswc: "T0345246801",
          coverOrSamples: false,
          coverNote: null,
        }}
      />,
    );
    expect(html).toContain("Ada (composer, 100%, PRS, IPI 123456789)");
    expect(html).toContain("Self-published");
    expect(html).toContain("T-034.524.680-1");
  });

  it("says when nothing is entered", () => {
    expect(renderToStaticMarkup(<CompositionSummary composition={null} />)).toContain("No composition details yet.");
  });
});
