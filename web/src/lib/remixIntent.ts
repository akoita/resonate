/**
 * Remix Studio creation intents (#1879 Phase 2).
 *
 * The studio used to expose two independent selectors — a mode (stem mix /
 * variation / extension) and, for variations, an AI target (whole track / new
 * layer / replace stem). The Create panel collapses them into one flat list of
 * user intents. These pure helpers map between the intent the user picks and
 * the `mode` + `aiTargetKind` pair the backend contract still speaks.
 */

export type RemixIntent =
  | "mix"
  | "reimagine"
  | "add_part"
  | "replace_stem"
  | "extend";

export type RemixAiIntent = Exclude<RemixIntent, "mix">;

export type RemixIntentAiTargetKind = "whole" | "add_layer" | "replace_stem";

export type RemixIntentState = {
  mode: "stem_mix" | "variation" | "extension";
  aiTargetKind: RemixIntentAiTargetKind;
};

/** The intent the current editor state represents. Unknown modes map to mix. */
export function intentFromState(
  mode: string,
  aiTargetKind: RemixIntentAiTargetKind,
): RemixIntent {
  if (mode === "extension") return "extend";
  if (mode === "variation") {
    if (aiTargetKind === "add_layer") return "add_part";
    if (aiTargetKind === "replace_stem") return "replace_stem";
    return "reimagine";
  }
  return "mix";
}

/** The editor state an intent selects. */
export function stateForIntent(intent: RemixIntent): RemixIntentState {
  switch (intent) {
    case "reimagine":
      return { mode: "variation", aiTargetKind: "whole" };
    case "add_part":
      return { mode: "variation", aiTargetKind: "add_layer" };
    case "replace_stem":
      return { mode: "variation", aiTargetKind: "replace_stem" };
    case "extend":
      return { mode: "extension", aiTargetKind: "whole" };
    case "mix":
    default:
      return { mode: "stem_mix", aiTargetKind: "whole" };
  }
}

/** Whether an intent runs AI generation (everything except the free mix). */
export function isAiIntent(intent: RemixIntent): intent is RemixAiIntent {
  return intent !== "mix";
}

/**
 * The intent a "Mix stems" | "Add AI" switch click selects: switching to AI
 * keeps an already-active AI intent and otherwise defaults to "reimagine".
 */
export function intentForSwitch(
  side: "mix" | "ai",
  current: RemixIntent,
): RemixIntent {
  if (side === "mix") return "mix";
  return isAiIntent(current) ? current : "reimagine";
}

/** Ordered AI intents with one-line honest descriptions. */
export const REMIX_AI_INTENTS: ReadonlyArray<{
  intent: RemixAiIntent;
  label: string;
  description: string;
}> = [
  {
    intent: "reimagine",
    label: "Reimagine the track",
    description:
      "The AI reinterprets the whole arrangement as one generated layer over your stems.",
  },
  {
    intent: "add_part",
    label: "Add a new part",
    description:
      "The AI generates one new part that sits on top of your arranged stems.",
  },
  {
    intent: "replace_stem",
    label: "Replace a stem",
    description:
      "The AI generates an isolated part to take that stem's place; your other stems stay untouched.",
  },
  {
    intent: "extend",
    label: "Extend the track",
    description:
      "The AI generates a continuation that develops your arrangement further.",
  },
];

export type RemixProvenanceChip = { label: string; tone: "stems" | "ai" };

/**
 * Short provenance chip for a draft's grounding (#1181). The full honest
 * description stays available as expandable detail next to the chip.
 */
export function provenanceChip(
  grounding: string | null | undefined,
): RemixProvenanceChip | null {
  switch (grounding) {
    case "stem_audio":
      return { label: "Your stems only", tone: "stems" };
    case "stem_plus_ai":
      return { label: "Your stems + AI layer", tone: "ai" };
    case "audio_conditioned":
      return { label: "AI · heard your stems", tone: "ai" };
    case "feature_conditioned":
      return { label: "AI · tempo/key matched", tone: "ai" };
    case "prompt_only":
      return { label: "AI · prompt only", tone: "ai" };
    default:
      return null;
  }
}
