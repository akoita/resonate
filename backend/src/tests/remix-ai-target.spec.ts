/**
 * Persisted variation AI target (#1882) — pure unit tests.
 *
 * PATCH input normalization, tolerant stored reads, and the generate fallback
 * that derives a per-stem transform from the saved target. No DB, no providers.
 */

import {
  normalizeAiTargetInput,
  readStoredAiTarget,
  stemTransformFromAiTarget,
} from "../modules/remix/remix-generation.provider";

const STEM_IDS = ["stem-vocals", "stem-drums"];

describe("normalizeAiTargetInput", () => {
  it("clears on null and normalizes whole to null", () => {
    expect(normalizeAiTargetInput(null, STEM_IDS)).toEqual({ value: null });
    expect(normalizeAiTargetInput({ kind: "whole" }, STEM_IDS)).toEqual({
      value: null,
    });
    expect(
      normalizeAiTargetInput({ kind: "whole", stemId: null }, STEM_IDS),
    ).toEqual({ value: null });
  });

  it("stores add_layer and replace_stem with a null default stemId", () => {
    expect(normalizeAiTargetInput({ kind: "add_layer" }, STEM_IDS)).toEqual({
      value: { kind: "add_layer", stemId: null },
    });
    expect(normalizeAiTargetInput({ kind: "replace_stem" }, STEM_IDS)).toEqual({
      value: { kind: "replace_stem", stemId: null },
    });
    expect(
      normalizeAiTargetInput(
        { kind: "replace_stem", stemId: "stem-drums" },
        STEM_IDS,
      ),
    ).toEqual({ value: { kind: "replace_stem", stemId: "stem-drums" } });
  });

  it("rejects unknown kinds and non-object payloads", () => {
    expect(normalizeAiTargetInput({ kind: "remix_all" }, STEM_IDS)).toEqual({
      error: expect.stringMatching(/aiTarget.kind must be one of/),
    });
    expect(normalizeAiTargetInput({}, STEM_IDS)).toEqual({
      error: expect.stringMatching(/aiTarget.kind/),
    });
    expect(normalizeAiTargetInput("add_layer", STEM_IDS)).toEqual({
      error: expect.stringMatching(/object or null/),
    });
    expect(normalizeAiTargetInput([], STEM_IDS)).toEqual({
      error: expect.stringMatching(/object or null/),
    });
  });

  it("allows stemId only on replace_stem, and only for project stems", () => {
    expect(
      normalizeAiTargetInput(
        { kind: "add_layer", stemId: "stem-drums" },
        STEM_IDS,
      ),
    ).toEqual({ error: expect.stringMatching(/only applies to replace_stem/) });
    expect(
      normalizeAiTargetInput({ kind: "whole", stemId: "stem-drums" }, STEM_IDS),
    ).toEqual({ error: expect.stringMatching(/only applies to replace_stem/) });
    expect(
      normalizeAiTargetInput({ kind: "replace_stem", stemId: "nope" }, STEM_IDS),
    ).toEqual({ error: expect.stringMatching(/not part of this project/) });
    expect(
      normalizeAiTargetInput({ kind: "replace_stem", stemId: 42 }, STEM_IDS),
    ).toEqual({ error: expect.stringMatching(/non-empty stem id/) });
  });
});

describe("readStoredAiTarget", () => {
  it("reads valid targets and treats anything malformed as null", () => {
    expect(readStoredAiTarget(null)).toBeNull();
    expect(readStoredAiTarget({ kind: "whole" })).toBeNull();
    expect(readStoredAiTarget({ kind: "bogus" })).toBeNull();
    expect(readStoredAiTarget("add_layer")).toBeNull();
    expect(readStoredAiTarget([])).toBeNull();
    expect(readStoredAiTarget({ kind: "add_layer", stemId: "x" })).toEqual({
      kind: "add_layer",
      stemId: null,
    });
    expect(readStoredAiTarget({ kind: "replace_stem", stemId: 7 })).toEqual({
      kind: "replace_stem",
      stemId: null,
    });
    expect(
      readStoredAiTarget({ kind: "replace_stem", stemId: "stem-drums" }),
    ).toEqual({ kind: "replace_stem", stemId: "stem-drums" });
  });
});

describe("stemTransformFromAiTarget", () => {
  it("derives transforms for variation mode", () => {
    expect(
      stemTransformFromAiTarget({ kind: "add_layer", stemId: null }, "variation"),
    ).toEqual({ transform: { kind: "add_layer" } });
    expect(
      stemTransformFromAiTarget(
        { kind: "replace_stem", stemId: "stem-drums" },
        "variation",
      ),
    ).toEqual({ transform: { kind: "replace_stem", stemId: "stem-drums" } });
  });

  it("keeps whole-track generation for null, whole, and malformed targets", () => {
    expect(stemTransformFromAiTarget(null, "variation")).toEqual({});
    expect(stemTransformFromAiTarget({ kind: "whole" }, "variation")).toEqual(
      {},
    );
    expect(stemTransformFromAiTarget({ kind: "bogus" }, "variation")).toEqual(
      {},
    );
  });

  it("asks for the stem when replace_stem has none", () => {
    expect(
      stemTransformFromAiTarget(
        { kind: "replace_stem", stemId: null },
        "variation",
      ),
    ).toEqual({ error: "Pick the stem to replace first" });
  });

  it("ignores the saved target outside variation mode", () => {
    for (const mode of ["stem_mix", "extension"]) {
      expect(
        stemTransformFromAiTarget({ kind: "add_layer", stemId: null }, mode),
      ).toEqual({});
      expect(
        stemTransformFromAiTarget(
          { kind: "replace_stem", stemId: null },
          mode,
        ),
      ).toEqual({});
    }
  });
});
