/**
 * Curated prompt presets for Remix Studio's prompted modes (#1177).
 *
 * Transparency rule: presets are templates that fill the editable prompt
 * textarea — the user always sees and owns exactly what is sent. The copy
 * describes the desired SOUND only; the backend prompt builder
 * (buildLyriaRemixPrompt) prepends the mode phrasing ("Create a reinterpreted
 * variation of the source arrangement: …"), so presets must not duplicate
 * that boilerplate.
 */

export type RemixPromptPreset = {
  /** Short chip label. */
  label: string;
  /** Full prompt text written into the textarea. */
  prompt: string;
};

export type RemixPromptPresetMode = "variation" | "extension";

export const REMIX_PROMPT_PRESETS: Record<
  RemixPromptPresetMode,
  readonly RemixPromptPreset[]
> = {
  variation: [
    {
      label: "Lo-fi chill",
      prompt:
        "A slowed, dusty lo-fi reinterpretation with mellow keys, soft vinyl crackle, and a relaxed head-nod groove.",
    },
    {
      label: "Club remix",
      prompt:
        "A high-energy club remix with a four-on-the-floor kick, rolling bassline, crisp hi-hats, and tension-building risers.",
    },
    {
      label: "Darker",
      prompt:
        "A darker, halftime reinterpretation with sparse percussion, sub-heavy bass, and a brooding, cinematic atmosphere.",
    },
    {
      label: "Acoustic",
      prompt:
        "An intimate acoustic rework with organic percussion, warm guitar voicings, and stripped-back dynamics.",
    },
  ],
  extension: [
    {
      label: "Build a drop",
      prompt:
        "Build tension from the existing groove into an explosive second drop with layered drums, a wider stereo image, and a heavier low end.",
    },
    {
      label: "Add a bridge",
      prompt:
        "A contrasting bridge section that strips back to the core melody and softer textures before returning to the main groove.",
    },
    {
      label: "Outro",
      prompt:
        "A gradual outro that deconstructs the arrangement element by element, easing the energy down to a clean ending.",
    },
  ],
};

/** Presets for the current editor mode; empty for stem_mix (no prompts). */
export function presetsForMode(mode: string): readonly RemixPromptPreset[] {
  if (mode === "variation" || mode === "extension") {
    return REMIX_PROMPT_PRESETS[mode];
  }
  return [];
}

/** The label of the preset the current prompt text matches, if any. */
export function activePresetLabel(mode: string, prompt: string): string | null {
  const trimmed = prompt.trim();
  if (!trimmed) return null;
  const match = presetsForMode(mode).find((preset) => preset.prompt === trimmed);
  return match?.label ?? null;
}
