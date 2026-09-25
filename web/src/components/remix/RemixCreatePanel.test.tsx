import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { REMIX_PROMPT_PRESETS } from "../../lib/remixPromptPresets";
import { REMIX_RECIPES } from "../../lib/remixRecipes";
import { REMIX_AI_INTENTS } from "../../lib/remixIntent";
import { REMIX_FX_SCHEMA_VERSION, REMIX_VIBES } from "../../lib/remixFx";
import {
  primaryActionable,
  primaryClickHandler,
  REMIX_STUDIO_LOCKED_NOTE,
  RemixCreatePanel,
  STEM_MIX_FREE_NOTE,
  type RemixCreatePanelProps,
} from "./RemixCreatePanel";

const noop = () => undefined;

/** The opening tag of the first button carrying `className`. */
function buttonTag(html: string, className: string): string {
  const match = html.match(new RegExp(`<button[^>]*${className}[^>]*>`));
  return match?.[0] ?? "";
}

function props(overrides: Partial<RemixCreatePanelProps> = {}): RemixCreatePanelProps {
  return {
    intent: "mix",
    onIntentChange: noop,
    prompt: "",
    onPromptChange: noop,
    presets: [],
    activePresetLabel: null,
    replaceStemOptions: [
      { stemId: "stem-vox", name: "Vocals" },
      { stemId: "stem-drums", name: "Drums" },
    ],
    replaceStemId: null,
    onReplaceStemChange: noop,
    recipes: [...REMIX_RECIPES],
    onApplyRecipe: noop,
    effects: null,
    onApplyVibe: noop,
    onMasterFxChange: noop,
    primary: {
      label: "Render mix",
      enabled: true,
      reason: null,
      busy: false,
      onClick: noop,
    },
    creditMeter: <div className="test-credit-meter">credits</div>,
    attribution: <p className="test-attribution">Powered by</p>,
    locked: false,
    ...overrides,
  };
}

function render(overrides: Partial<RemixCreatePanelProps> = {}): string {
  return renderToStaticMarkup(<RemixCreatePanel {...props(overrides)} />);
}

describe("RemixCreatePanel — Mix stems", () => {
  it("shows the switch with Mix stems active, the free note and recipes", () => {
    const html = render();
    expect(html).toMatch(/aria-pressed="true"[^>]*remix-create-switch-mix/);
    expect(html).toMatch(/aria-pressed="false"[^>]*remix-create-switch-ai/);
    expect(html).toContain(STEM_MIX_FREE_NOTE);
    for (const recipe of REMIX_RECIPES) {
      expect(html).toContain(recipe.label.replaceAll("&", "&amp;"));
    }
    expect(html).toContain("One-click arrangements");
  });

  it("does not render AI-only controls", () => {
    const html = render();
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain('role="radiogroup"');
    expect(html).not.toContain("Uses generation credits");
    expect(html).not.toContain("test-credit-meter");
    expect(html).not.toContain("test-attribution");
  });

  it("omits the recipe block when no recipe applies", () => {
    const html = render({ recipes: [] });
    expect(html).not.toContain("One-click arrangements");
    expect(html).toContain(STEM_MIX_FREE_NOTE);
  });
});

describe("RemixCreatePanel — Add AI", () => {
  it("renders the intents as a radio group with the active one checked", () => {
    const html = render({ intent: "add_part" });
    expect(html).toMatch(/aria-pressed="true"[^>]*remix-create-switch-ai/);
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain("Reimagine the track");
    expect(html).toContain("Add a new part");
    expect(html).toContain("Replace a stem");
    expect(html).toContain("Extend the track");
    const checked = html.match(/<input[^>]*checked=""[^>]*>/g) ?? [];
    expect(checked).toHaveLength(1);
    expect(checked[0]).toContain('value="add_part"');
    expect(html).toContain(
      "The AI generates one new part that sits on top of your arranged stems.",
    );
    expect(html).not.toContain(STEM_MIX_FREE_NOTE);
  });

  it("shows the prompt textarea, presets, credit meter and attribution", () => {
    const html = render({
      intent: "reimagine",
      prompt: REMIX_PROMPT_PRESETS.variation[1].prompt,
      presets: REMIX_PROMPT_PRESETS.variation,
      activePresetLabel: "Club remix",
    });
    expect(html).toContain("<textarea");
    expect(html).toContain('aria-label="Prompt presets"');
    expect(html).toMatch(/aria-pressed="true"[^>]*>Club remix</);
    expect(html).toMatch(/aria-pressed="false"[^>]*>Lo-fi chill</);
    expect(html).toContain("test-credit-meter");
    expect(html).toContain("test-attribution");
  });

  it("shows the stem picker only for replace_stem", () => {
    expect(render({ intent: "reimagine" })).not.toContain("<select");
    expect(render({ intent: "extend" })).not.toContain("<select");
    const html = render({ intent: "replace_stem", replaceStemId: "stem-drums" });
    expect(html).toContain("<select");
    expect(html).toContain("Stem to replace");
    expect(html).toContain("Choose stem…");
    expect(html).toMatch(/<option value="stem-drums" selected="">Drums<\/option>/);
  });

  it("shows exactly one intent description — the selected one — as helper text", () => {
    for (const selected of REMIX_AI_INTENTS) {
      const html = render({ intent: selected.intent });
      const shown = REMIX_AI_INTENTS.filter((entry) =>
        html.includes(entry.description.replaceAll("'", "&#x27;")),
      );
      expect(shown.map((entry) => entry.intent)).toEqual([selected.intent]);
      expect(html.match(/remix-intent-description/g) ?? []).toHaveLength(1);
      // The radiogroup points at the helper text.
      const describedBy = html.match(
        /role="radiogroup"[^>]*aria-describedby="([^"]+)"/,
      )?.[1];
      expect(describedBy).toBeTruthy();
      expect(html).toContain(`id="${describedBy}"`);
      expect(html).toMatch(
        new RegExp(`id="${describedBy}"[^>]*>${selected.description.replaceAll("'", "&#x27;")}<`),
      );
    }
  });

  it("renders each intent as a compact label-only line", () => {
    const html = render({ intent: "reimagine" });
    const labels = html.match(/<label[^>]*remix-intent remix-intent-[^>]*>/g) ?? [];
    expect(labels).toHaveLength(4);
    for (const label of labels) expect(label).toContain("min-h-9");
    expect(html).toMatch(/remix-intent-reimagine[^"]*border-purple-500\/60/);
  });

  it("leaves the price to the credit meter (no standalone price line)", () => {
    const html = render({ intent: "extend" });
    expect(html).not.toContain("Uses generation credits");
    expect(html).not.toContain("remix-create-price");
  });
});

describe("RemixCreatePanel — primary action", () => {
  it("renders an enabled primary without aria-disabled", () => {
    const html = render();
    expect(html).toMatch(/<button[^>]*remix-generate-btn[^>]*>Render mix<\/button>/);
    expect(buttonTag(html, "remix-generate-btn")).not.toContain("aria-disabled");
  });

  it("marks a disabled primary aria-disabled and shows its reason", () => {
    const reason = "Write a prompt first — generation follows your direction.";
    const html = render({
      intent: "reimagine",
      primary: { label: "Generate AI draft", enabled: false, reason, busy: false, onClick: noop },
    });
    expect(buttonTag(html, "remix-generate-btn")).toContain('aria-disabled="true"');
    expect(html).toContain(reason);
    // aria-disabled, not a dead native-disabled button.
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*remix-generate-btn/);
  });

  it("never runs the action while disabled, busy or locked", () => {
    const onClick = vi.fn();
    const preventDefault = vi.fn();
    const base = { label: "Go", enabled: true, reason: null, busy: false, onClick };

    primaryClickHandler({ ...base, enabled: false }, false)({ preventDefault });
    primaryClickHandler({ ...base, busy: true }, false)({ preventDefault });
    primaryClickHandler(base, true)({ preventDefault });
    expect(onClick).not.toHaveBeenCalled();
    expect(preventDefault).toHaveBeenCalledTimes(3);

    primaryClickHandler(base, false)({ preventDefault });
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(primaryActionable(base, false)).toBe(true);
  });
});

describe("RemixCreatePanel — locked", () => {
  it("disables every control and explains the lock", () => {
    const html = render({ intent: "replace_stem", locked: true });
    expect(html).toContain(REMIX_STUDIO_LOCKED_NOTE);
    expect(buttonTag(html, "remix-generate-btn")).toContain('aria-disabled="true"');
    expect(html).toMatch(/<textarea[^>]*disabled=""/);
    expect(html).toMatch(/<select[^>]*disabled=""/);
    const radios = html.match(/<input[^>]*type="radio"[^>]*>/g) ?? [];
    expect(radios).toHaveLength(4);
    for (const radio of radios) expect(radio).toContain('disabled=""');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*remix-create-switch-mix/);
  });

  it("disables recipes when locked", () => {
    const html = render({ locked: true });
    const recipes = html.match(/<button[^>]*remix-recipe-btn[^>]*>/g) ?? [];
    expect(recipes.length).toBeGreaterThan(0);
    for (const recipe of recipes) expect(recipe).toContain('disabled=""');
  });
});

describe("RemixCreatePanel — Vibe (#1897)", () => {
  it("shows the vibe starters above the arrangements, No effects active by default", () => {
    const html = render();
    for (const vibe of REMIX_VIBES) {
      expect(html).toContain(vibe.label);
    }
    expect(html.indexOf("remix-vibe")).toBeLessThan(
      html.indexOf("One-click arrangements"),
    );
    expect(buttonTag(html, "remix-vibe-none")).toContain(
      'aria-pressed="true"',
    );
    expect(buttonTag(html, "remix-vibe-lofi")).toContain('aria-pressed="false"');
  });

  it("shows the four plain-language master controls", () => {
    const html = render();
    for (const label of [
      "Speed",
      "Space",
      "Tone",
      "Warmth",
      "Slowed",
      "Sped up",
      "Dry",
      "Roomy",
      "Darker",
      "Brighter",
      "Clean",
      "Warm",
    ]) {
      expect(html).toContain(`>${label}<`);
    }
    expect(html).toMatch(/type="range" min="0.75" max="1.25" step="0.01"/);
    expect(html).toContain('aria-valuetext="1.00×"');
  });

  it("marks the active vibe when the controls match it exactly", () => {
    const slowed = render({
      effects: {
        schemaVersion: REMIX_FX_SCHEMA_VERSION,
        master: { speed: 0.85, space: 0.45, tone: -0.15 },
      },
    });
    expect(buttonTag(slowed, "remix-vibe-slowed_reverb")).toContain(
      'aria-pressed="true"',
    );
    expect(slowed).toContain('aria-valuetext="0.85×"');
    expect(slowed).toContain('aria-valuetext="45%"');
    expect(slowed).toContain('aria-valuetext="Darker 15%"');

    const custom = render({
      effects: { schemaVersion: REMIX_FX_SCHEMA_VERSION, master: { speed: 0.86 } },
    });
    expect(custom).not.toMatch(/aria-pressed="true"[^>]*remix-vibe-btn/);
    expect(custom).toContain(">Custom<");
  });

  it("locks the vibe controls on a published remix", () => {
    const html = render({ locked: true });
    expect(buttonTag(html, "remix-vibe-dreamy")).toContain('disabled=""');
    expect(countRanges(html, true)).toBe(4);
  });

  it("is not part of the AI side", () => {
    expect(render({ intent: "reimagine" })).not.toContain("remix-vibe");
  });
});

function countRanges(html: string, disabled: boolean): number {
  const ranges = html.match(/<input[^>]*type="range"[^>]*>/g) ?? [];
  return ranges.filter((tag) => tag.includes('disabled=""') === disabled).length;
}
