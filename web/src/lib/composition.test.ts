import { describe, expect, it } from "vitest";
import {
  EMPTY_COMPOSITION_DRAFT,
  EMPTY_WRITER,
  draftFromComposition,
  formatIswc,
  formatWriterCredits,
  hasCompositionErrors,
  toCompositionInput,
  validateCompositionDraft,
  type CompositionDraft,
} from "./composition";

const draft = (patch: Partial<CompositionDraft>): CompositionDraft => ({ ...EMPTY_COMPOSITION_DRAFT, writers: [], ...patch });

describe("composition drafts (#2669)", () => {
  it("sends nothing for an empty draft", () => {
    expect(toCompositionInput(draft({ writers: [{ ...EMPTY_WRITER }] }))).toBeNull();
    expect(hasCompositionErrors(validateCompositionDraft(EMPTY_COMPOSITION_DRAFT))).toBe(false);
  });

  it("builds the request body", () => {
    const input = toCompositionInput(
      draft({
        writers: [
          { name: " Ada ", role: "composer", share: "60,5", society: "SACEM", ipi: "00.123.456.789" },
          { name: "Grace", role: "lyricist", share: "39.5", society: "", ipi: "" },
          { ...EMPTY_WRITER },
        ],
        publisher: "Ignored",
        selfPublished: true,
        iswc: "T-034.524.680-1",
        coverNote: "ignored without the declaration",
      }),
    );
    expect(input).toEqual({
      writers: [
        { name: "Ada", role: "composer", share: 60.5, society: "SACEM", ipi: "00123456789" },
        { name: "Grace", role: "lyricist", share: 39.5 },
      ],
      publisher: null,
      selfPublished: true,
      iswc: "T-034.524.680-1",
      coverOrSamples: false,
      coverNote: null,
    });
  });

  it("explains share, code and name problems", () => {
    const errors = validateCompositionDraft(
      draft({
        writers: [
          { name: "Ada", role: "composer", share: "50", society: "", ipi: "" },
          { name: "Grace", role: "lyricist", share: "40", society: "", ipi: "1234" },
          { name: "", role: "arranger", share: "10", society: "", ipi: "" },
        ],
        iswc: "T-034.524.680-2",
      }),
    );
    expect(errors.writerRows).toEqual({ 1: "An IPI number has 9 to 11 digits.", 2: "Add the writer's name." });
    expect(errors.iswc).toMatch(/check digit/);
    expect(
      validateCompositionDraft(
        draft({
          writers: [
            { name: "Ada", role: "composer", share: "50", society: "", ipi: "" },
            { name: "Grace", role: "lyricist", share: "", society: "", ipi: "" },
          ],
        }),
      ).writers,
    ).toBe("When you enter shares, give every writer a share.");
    expect(
      validateCompositionDraft(
        draft({
          writers: [
            { name: "A", role: "composer", share: "33.33", society: "", ipi: "" },
            { name: "B", role: "composer", share: "33.33", society: "", ipi: "" },
            { name: "C", role: "composer", share: "33.33", society: "", ipi: "" },
          ],
        }),
      ).writers,
    ).toBe("Shares must add up to 100%. They add up to 99.99%.");
  });

  it("round-trips stored details into the form", () => {
    const back = draftFromComposition({
      writers: [{ name: "Ada", role: "composer", share: 100, ipi: "123456789" }],
      publisher: "P",
      selfPublished: false,
      iswc: "T0345246801",
      coverOrSamples: true,
      coverNote: "note",
    });
    expect(back.iswc).toBe("T-034.524.680-1");
    expect(back.writers[0]).toEqual({ name: "Ada", role: "composer", share: "100", society: "", ipi: "123456789" });
    expect(draftFromComposition(null)).toEqual(EMPTY_COMPOSITION_DRAFT);
  });

  it("formats credits and codes", () => {
    expect(formatWriterCredits([{ name: "Ada", role: "composer" }, { name: "Grace", role: "lyricist" }])).toBe(
      "Ada (composer), Grace (lyricist)",
    );
    expect(formatIswc("T0345246801")).toBe("T-034.524.680-1");
    expect(formatIswc(null)).toBe("");
  });
});
