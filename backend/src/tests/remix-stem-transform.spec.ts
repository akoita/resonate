/**
 * Per-stem AI transforms (#1316) — pure unit tests.
 *
 * Transform validation, honest prompt framing, and generation-input threading.
 * No DB, no providers.
 */

import {
  buildRemixGenerationInput,
  stemTransformPromptLead,
  validateStemTransform,
} from "../modules/remix/remix-generation.provider";
import { buildLyriaRemixPrompt } from "../modules/remix/lyria-remix-generation.provider";

const PROJECT = {
  mode: "variation",
  stems: [
    { stemId: "stem-vocals", muted: false },
    { stemId: "stem-drums", muted: false },
    { stemId: "stem-bass", muted: true },
  ],
};

describe("validateStemTransform", () => {
  it("accepts absent transforms and both valid kinds", () => {
    expect(validateStemTransform(undefined, PROJECT)).toBeNull();
    expect(
      validateStemTransform(
        { kind: "replace_stem", stemId: "stem-drums" },
        PROJECT,
      ),
    ).toBeNull();
    expect(validateStemTransform({ kind: "add_layer" }, PROJECT)).toBeNull();
  });

  it("rejects unknown kinds and non-variation modes", () => {
    expect(
      validateStemTransform({ kind: "remix_all" as never }, PROJECT),
    ).toMatch(/kind must be/);
    expect(
      validateStemTransform(
        { kind: "add_layer" },
        { ...PROJECT, mode: "stem_mix" },
      ),
    ).toMatch(/variation mode only/);
    expect(
      validateStemTransform(
        { kind: "replace_stem", stemId: "stem-drums" },
        { ...PROJECT, mode: "extension" },
      ),
    ).toMatch(/variation mode only/);
  });

  it("enforces replace_stem targeting rules", () => {
    expect(validateStemTransform({ kind: "replace_stem" }, PROJECT)).toMatch(
      /stemId is required/,
    );
    expect(
      validateStemTransform(
        { kind: "replace_stem", stemId: "stem-unknown" },
        PROJECT,
      ),
    ).toMatch(/not part of this project/);
    expect(
      validateStemTransform(
        { kind: "add_layer", stemId: "stem-drums" },
        PROJECT,
      ),
    ).toMatch(/does not apply to add_layer/);
  });

  it("rejects replacing the only unmuted stem (the bed would be empty)", () => {
    const soloProject = {
      mode: "variation",
      stems: [
        { stemId: "stem-drums", muted: false },
        { stemId: "stem-vocals", muted: true },
      ],
    };
    expect(
      validateStemTransform(
        { kind: "replace_stem", stemId: "stem-drums" },
        soloProject,
      ),
    ).toMatch(/no unmuted stems to condition on/);
    // Replacing a MUTED stem is fine while another stem still plays.
    expect(
      validateStemTransform(
        { kind: "replace_stem", stemId: "stem-vocals" },
        soloProject,
      ),
    ).toBeNull();
  });
});

describe("stemTransformPromptLead", () => {
  it("asks for an isolated role replacement with the catalog label", () => {
    expect(
      stemTransformPromptLead(
        { kind: "replace_stem", stemId: "s", stemLabel: "drums" },
        "darker, halftime",
      ),
    ).toBe(
      "Generate an isolated drums track to replace the source drums: darker, halftime. Produce only the drums part — no other instruments.",
    );
    // Missing label falls back honestly instead of inventing a role.
    expect(
      stemTransformPromptLead({ kind: "replace_stem" }, "darker"),
    ).toContain("isolated target stem track");
  });

  it("asks for exactly one additive layer", () => {
    expect(
      stemTransformPromptLead({ kind: "add_layer" }, "warm synth pad"),
    ).toBe(
      "Generate one new additive layer for the source arrangement: warm synth pad. Produce only that single layer so it can sit on top of the existing mix.",
    );
  });
});

describe("buildLyriaRemixPrompt with a transform", () => {
  it("replaces the variation framing but keeps measured hints", () => {
    const prompt = buildLyriaRemixPrompt({
      mode: "variation",
      userPrompt: "darker, halftime",
      transform: { kind: "replace_stem", stemLabel: "drums" },
      bpm: 93,
      key: "G minor",
      sourceMatched: { bpm: true, key: true },
    });
    expect(prompt).toContain("Generate an isolated drums track");
    expect(prompt).not.toContain("reinterpreted variation");
    expect(prompt).toContain("Tempo around 93 BPM.");
    expect(prompt).toContain("In the key of G minor.");
    expect(prompt).toContain("measured from the source stems");
  });

  it("keeps the whole-track framing when no transform is set", () => {
    expect(
      buildLyriaRemixPrompt({ mode: "variation", userPrompt: "lo-fi" }),
    ).toContain("reinterpreted variation of the source arrangement");
  });
});

describe("buildRemixGenerationInput", () => {
  const project = {
    id: "proj-1",
    creatorUserId: "user-1",
    sourceTrackId: "track-1",
    mode: "variation",
    prompt: "darker drums",
    licenseType: "remix",
    licenseId: null,
    policyVersion: "test",
    source: { rightsRoute: "STANDARD_ESCROW", contentStatus: "clean" },
    stems: [
      { stemId: "stem-vocals", muted: false },
      { stemId: "stem-drums", muted: false },
    ],
  };

  it("threads the transform through to the provider input", () => {
    const input = buildRemixGenerationInput(project, {}, {
      kind: "replace_stem",
      stemId: "stem-drums",
      stemLabel: "drums",
    });
    expect(input.stemTransform).toEqual({
      kind: "replace_stem",
      stemId: "stem-drums",
      stemLabel: "drums",
    });
  });

  it("omits the field entirely for whole-track generations", () => {
    const input = buildRemixGenerationInput(project);
    expect("stemTransform" in input).toBe(false);
  });
});
