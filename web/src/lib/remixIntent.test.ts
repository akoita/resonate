import { describe, expect, it } from "vitest";
import {
  intentForSwitch,
  intentFromState,
  isAiIntent,
  provenanceChip,
  REMIX_AI_INTENTS,
  stateForIntent,
  type RemixIntent,
} from "./remixIntent";

describe("intentFromState", () => {
  it("maps stem_mix to mix regardless of the AI target", () => {
    expect(intentFromState("stem_mix", "whole")).toBe("mix");
    expect(intentFromState("stem_mix", "replace_stem")).toBe("mix");
  });

  it("maps variation targets to their intents", () => {
    expect(intentFromState("variation", "whole")).toBe("reimagine");
    expect(intentFromState("variation", "add_layer")).toBe("add_part");
    expect(intentFromState("variation", "replace_stem")).toBe("replace_stem");
  });

  it("maps extension to extend regardless of the AI target", () => {
    expect(intentFromState("extension", "whole")).toBe("extend");
    expect(intentFromState("extension", "add_layer")).toBe("extend");
  });

  it("falls back to mix for unknown modes", () => {
    expect(intentFromState("", "whole")).toBe("mix");
    expect(intentFromState("mashup", "add_layer")).toBe("mix");
  });
});

describe("stateForIntent", () => {
  it("round-trips every intent through intentFromState", () => {
    const intents: RemixIntent[] = [
      "mix",
      "reimagine",
      "add_part",
      "replace_stem",
      "extend",
    ];
    for (const intent of intents) {
      const state = stateForIntent(intent);
      expect(intentFromState(state.mode, state.aiTargetKind)).toBe(intent);
    }
  });

  it("selects the backend mode and AI target", () => {
    expect(stateForIntent("mix")).toEqual({ mode: "stem_mix", aiTargetKind: "whole" });
    expect(stateForIntent("reimagine")).toEqual({ mode: "variation", aiTargetKind: "whole" });
    expect(stateForIntent("add_part")).toEqual({ mode: "variation", aiTargetKind: "add_layer" });
    expect(stateForIntent("replace_stem")).toEqual({
      mode: "variation",
      aiTargetKind: "replace_stem",
    });
    expect(stateForIntent("extend")).toEqual({ mode: "extension", aiTargetKind: "whole" });
  });
});

describe("intentForSwitch", () => {
  it("selects mix for the Mix stems side", () => {
    expect(intentForSwitch("mix", "extend")).toBe("mix");
  });

  it("defaults to reimagine when switching from mix to AI", () => {
    expect(intentForSwitch("ai", "mix")).toBe("reimagine");
  });

  it("keeps an already-active AI intent", () => {
    expect(intentForSwitch("ai", "replace_stem")).toBe("replace_stem");
    expect(intentForSwitch("ai", "extend")).toBe("extend");
  });

  it("classifies AI intents", () => {
    expect(isAiIntent("mix")).toBe(false);
    expect(isAiIntent("add_part")).toBe(true);
  });
});

describe("REMIX_AI_INTENTS", () => {
  it("lists the four AI intents in order with descriptions", () => {
    expect(REMIX_AI_INTENTS.map((entry) => entry.intent)).toEqual([
      "reimagine",
      "add_part",
      "replace_stem",
      "extend",
    ]);
    expect(REMIX_AI_INTENTS.map((entry) => entry.label)).toEqual([
      "Reimagine the track",
      "Add a new part",
      "Replace a stem",
      "Extend the track",
    ]);
    for (const entry of REMIX_AI_INTENTS) {
      expect(entry.description.length).toBeGreaterThan(10);
    }
  });
});

describe("provenanceChip", () => {
  it("labels each grounding honestly", () => {
    expect(provenanceChip("stem_audio")).toEqual({ label: "Your stems only", tone: "stems" });
    expect(provenanceChip("stem_plus_ai")).toEqual({
      label: "Your stems + AI layer",
      tone: "ai",
    });
    expect(provenanceChip("audio_conditioned")).toEqual({
      label: "AI · heard your stems",
      tone: "ai",
    });
    expect(provenanceChip("feature_conditioned")).toEqual({
      label: "AI · tempo/key matched",
      tone: "ai",
    });
    expect(provenanceChip("prompt_only")).toEqual({ label: "AI · prompt only", tone: "ai" });
  });

  it("returns null for missing or unknown groundings", () => {
    expect(provenanceChip(null)).toBeNull();
    expect(provenanceChip(undefined)).toBeNull();
    expect(provenanceChip("")).toBeNull();
    expect(provenanceChip("mystery")).toBeNull();
  });
});
