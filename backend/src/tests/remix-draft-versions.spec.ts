/**
 * Draft versions (#1320) — pure unit tests for the archive helpers.
 */

import {
  archiveEntryFromProject,
  previousDraftsFromMetadata,
} from "../modules/remix/remix-project.service";

const completedProject = (overrides: Record<string, unknown> = {}) => ({
  generationJobId: "job-1",
  generationProvider: "stem-mix-render",
  generationMetadata: {
    status: "completed",
    mode: "stem_mix",
    grounding: "stem_audio",
    estimatedCostUsd: 0,
    completedAt: "2026-07-01T00:00:00.000Z",
    output: { outputUri: "local://draft-1.mp3", mimeType: "audio/mpeg" },
    ...overrides,
  },
});

describe("archiveEntryFromProject", () => {
  it("captures a completed draft with its provenance and cost", () => {
    expect(
      archiveEntryFromProject(
        completedProject({
          estimatedCostUsd: 0.12,
          stemTransform: { kind: "replace_stem", stemLabel: "drums" },
        }),
      ),
    ).toEqual({
      jobId: "job-1",
      provider: "stem-mix-render",
      mode: "stem_mix",
      grounding: "stem_audio",
      stemTransform: { kind: "replace_stem", stemLabel: "drums" },
      estimatedCostUsd: 0.12,
      completedAt: "2026-07-01T00:00:00.000Z",
      output: { outputUri: "local://draft-1.mp3", mimeType: "audio/mpeg" },
    });
  });

  it("archives nothing without a completed, playable output", () => {
    expect(
      archiveEntryFromProject(completedProject({ status: "failed" })),
    ).toBeNull();
    expect(
      archiveEntryFromProject(completedProject({ output: null })),
    ).toBeNull();
    expect(
      archiveEntryFromProject({
        generationJobId: null,
        generationProvider: null,
        generationMetadata: null,
      }),
    ).toBeNull();
  });
});

describe("previousDraftsFromMetadata", () => {
  it("reads valid entries and drops malformed ones", () => {
    const valid = {
      jobId: "job-0",
      provider: "lyria",
      mode: "variation",
      grounding: "stem_plus_ai",
      stemTransform: null,
      estimatedCostUsd: 0.12,
      completedAt: null,
      output: { outputUri: "local://old.mp3", mimeType: null },
    };
    expect(
      previousDraftsFromMetadata({
        previousDrafts: [valid, { jobId: 42 }, "junk", { output: {} }],
      }),
    ).toEqual([valid]);
    expect(previousDraftsFromMetadata(null)).toEqual([]);
    expect(previousDraftsFromMetadata({})).toEqual([]);
  });
});
