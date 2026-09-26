import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { REMIX_PROMPT_PRESETS } from "../../lib/remixPromptPresets";
import { REMIX_RECIPES } from "../../lib/remixRecipes";
import { REMIX_AI_INTENTS } from "../../lib/remixIntent";
import { REMIX_FX_SCHEMA_VERSION, REMIX_VIBES } from "../../lib/remixFx";
import {
  identityBlocks,
  structureEditState,
  type RemixStructureBlock,
} from "../../lib/remixStructure";
import type { RemixSectionGrid } from "../../lib/api";
import {
  parseRemixDescription,
  type RemixDescribeContext,
} from "../../lib/remixDescribe";
import {
  DESCRIBE_APPLIED_NOTE,
  DESCRIBE_NOT_UNDERSTOOD,
  DESCRIBE_PRIVACY_NOTE,
  DescribeRemixView,
  describeProposal,
  type DescribeRemixViewProps,
  formatSongLength,
  structureShapeOptions,
  structureShapeResult,
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

describe("RemixCreatePanel — Song length & shape (#1899)", () => {
  // Four 16 s sections: 1:04, no pickup.
  const grid: RemixSectionGrid = {
    kind: "bars",
    sections: [0, 16, 32, 48].map((startSec) => ({ startSec, endSec: startSec + 16 })),
    sectionSeconds: 16,
    durationSeconds: 64,
    bpm: 120,
  };
  const stateFor = (blocks: RemixStructureBlock[] | null) =>
    structureEditState(grid, blocks ? { blocks } : null, {});

  it("offers three shapes with the length change spelled out", () => {
    const options = structureShapeOptions(grid, stateFor(null));
    expect(options.map((option) => option.label)).toEqual([
      "Original length",
      "Extended mix",
      "Short edit",
    ]);
    expect(options[0]).toMatchObject({ pressed: true, lengthLabel: "1:04" });
    // Extended: 0,0,1,2,3,3 = 96 s. Short: ceil(0.6 × 4) = 3 sections.
    expect(options[1]).toMatchObject({ pressed: false, lengthLabel: "1:04 → 1:36" });
    expect(options[2]).toMatchObject({ pressed: false, lengthLabel: "1:04 → 0:48" });
    expect(options[1].description).toBe("Longer intro and outro — handy for DJs");
    expect(options[2].description).toBe("About a third shorter, fades out");
  });

  it("presses the shape the structure already has", () => {
    const short = structureShapeResult(grid, stateFor(null), "short")!;
    const options = structureShapeOptions(grid, stateFor(short.blocks));
    expect(options.map((option) => option.pressed)).toEqual([false, false, true]);
    expect(options[0].lengthLabel).toBe("0:48 → 1:04");
    // Re-pressing an applied shape changes nothing.
    expect(structureShapeResult(grid, stateFor(short.blocks), "short")).toBeNull();
    expect(structureShapeResult(grid, stateFor(null), "original")).toBeNull();
  });

  it("disables the extended mix past the length cap, saying why", () => {
    const tight = { ...grid, durationSeconds: 40 }; // cap 80 s < 96 s
    const options = structureShapeOptions(
      tight,
      structureEditState(tight, null, {}),
    );
    expect(options[1]).toMatchObject({
      enabled: false,
      reason: "That would make the remix more than twice as long as the original.",
      lengthLabel: null,
    });
  });

  it("renders the section between Vibe and One-click arrangements", () => {
    const html = render({
      structureOptions: structureShapeOptions(grid, stateFor(null)),
      onApplyStructure: noop,
    });
    expect(html).toContain("Song length &amp; shape");
    expect(html.indexOf("remix-vibe-controls")).toBeLessThan(
      html.indexOf("remix-structure-shapes"),
    );
    expect(html.indexOf("remix-structure-shapes")).toBeLessThan(
      html.indexOf("One-click arrangements"),
    );
    expect(buttonTag(html, "remix-structure-shape-original")).toContain(
      'aria-pressed="true"',
    );
    expect(buttonTag(html, "remix-structure-shape-extended")).toContain(
      'aria-pressed="false"',
    );
    expect(html).toContain("1:04 → 1:36");
    expect(html).toContain("Longer intro and outro — handy for DJs");
    expect(buttonTag(html, "remix-structure-shape-short")).not.toContain('disabled=""');
  });

  it("locks the shapes on a published remix and hides them without a grid", () => {
    const locked = render({
      structureOptions: structureShapeOptions(grid, stateFor(identityBlocks(4))),
      onApplyStructure: noop,
      locked: true,
    });
    for (const id of ["original", "extended", "short"]) {
      expect(buttonTag(locked, `remix-structure-shape-${id}`)).toContain('disabled=""');
    }
    expect(render({ structureOptions: [], onApplyStructure: noop })).not.toContain(
      "remix-structure-shapes",
    );
    expect(render()).not.toContain("Song length");
    expect(render({ intent: "reimagine" })).not.toContain("remix-structure-shapes");
  });

  it("formats song lengths as m:ss", () => {
    expect(formatSongLength(216)).toBe("3:36");
    expect(formatSongLength(288.4)).toBe("4:48");
    expect(formatSongLength(-1)).toBe("0:00");
  });
});

describe("RemixCreatePanel — Describe it (#1900)", () => {
  const grid: RemixSectionGrid = {
    kind: "bars",
    sections: [0, 16, 32, 48].map((startSec) => ({ startSec, endSec: startSec + 16 })),
    sectionSeconds: 16,
    durationSeconds: 64,
    bpm: 120,
  };
  const describeContext: RemixDescribeContext = {
    edits: {
      stems: {
        "stem-vox": { gainDb: null, muted: false, sections: null },
        "stem-drums": { gainDb: null, muted: false, sections: null },
      },
      effects: null,
      structure: null,
    },
    stems: [
      { stemId: "stem-vox", type: "vocals", name: "Vocals", reference: false },
      { stemId: "stem-drums", type: "drums", name: "Drums", reference: false },
    ],
    grid,
  };
  const proposalFor = (text: string) =>
    describeProposal(parseRemixDescription(text), describeContext);
  const view = (overrides: Partial<DescribeRemixViewProps> = {}) =>
    renderToStaticMarkup(
      <DescribeRemixView
        text=""
        onTextChange={noop}
        onPreview={noop}
        proposal={null}
        onApply={noop}
        onCancel={noop}
        applied={false}
        onUndo={noop}
        locked={false}
        {...overrides}
      />,
    );

  it("renders the box at the top of Mix stems, above the Vibe", () => {
    const html = render({ describeContext, onApplyEdits: noop });
    expect(html).toContain("Describe the remix you want");
    expect(html).toContain('placeholder="e.g. slower and dreamy, no drums, longer"');
    expect(html).toMatch(/<input[^>]*maxLength="200"[^>]*remix-describe-input/);
    expect(html).toContain('aria-live="polite" class="remix-describe-proposal"');
    // Honest about where the words go, and tied to the input.
    expect(html).toContain(DESCRIBE_PRIVACY_NOTE);
    const privacyId = html.match(/id="([^"]*)" class="[^"]*remix-describe-privacy/)?.[1];
    expect(privacyId).toBeTruthy();
    expect(html).toMatch(
      new RegExp(`<input[^>]*aria-describedby="${privacyId}"[^>]*remix-describe-input`),
    );
    expect(html.indexOf("remix-describe")).toBeLessThan(html.indexOf("remix-vibe"));
    // Nothing is proposed before Preview.
    expect(html).not.toContain("remix-describe-apply");
    // Empty input: Preview waits for words.
    expect(buttonTag(html, "remix-describe-preview")).toContain('disabled=""');
    expect(buttonTag(html, "remix-describe-preview")).toContain('type="submit"');
  });

  it("is hidden without a context and on the Add AI side", () => {
    expect(render()).not.toContain("remix-describe");
    expect(render({ describeContext })).not.toContain("remix-describe");
    expect(
      render({ intent: "reimagine", describeContext, onApplyEdits: noop }),
    ).not.toContain("remix-describe");
  });

  it("shows a proposal as a diff with Apply and Cancel", () => {
    const proposal = proposalFor("slower, no drums, no guitar, purple");
    expect(proposal.understood).toBe(true);
    const html = view({ text: "slower, no drums, no guitar, purple", proposal });
    expect(html).toContain("Proposed changes");
    expect(html).toMatch(/Speed<\/span>.*1\.00×.*→.*0\.85×/);
    expect(html).toMatch(/Drums<\/span>.*on.*→.*muted/);
    expect(html).toContain("This track has no guitar stem");
    expect(html).toContain("Not understood: purple");
    // The shape line carries the length change.
    const longer = view({ text: "longer", proposal: proposalFor("longer") });
    expect(longer).toMatch(/Song shape<\/span>.*Original length.*→.*Extended mix \(1:04 → 1:36\)/);
    expect(buttonTag(html, "remix-describe-apply")).not.toContain('disabled=""');
    expect(buttonTag(html, "remix-describe-apply")).toContain("bg-purple-600");
    expect(buttonTag(html, "remix-describe-cancel")).toContain("bg-zinc-900");
    expect(buttonTag(html, "remix-describe-preview")).not.toContain('disabled=""');
  });

  it("says when nothing was understood, without an Apply", () => {
    const proposal = proposalFor("purple bananas");
    expect(proposal.understood).toBe(false);
    const html = view({ text: "purple bananas", proposal });
    expect(html).toContain(DESCRIBE_NOT_UNDERSTOOD.replace("'", "&#x27;"));
    expect(html).not.toContain("remix-describe-apply");
    expect(html).not.toContain("Not understood:");
    expect(html).toContain("remix-describe-cancel");
  });

  it("says when there is nothing to change", () => {
    const html = view({ text: "not so dark", proposal: proposalFor("not so dark") });
    expect(html).toContain("Nothing to change — it already sounds like that.");
    expect(html).not.toContain("remix-describe-apply");
    const missing = view({ text: "no guitar", proposal: proposalFor("no guitar") });
    expect(missing).toContain("Nothing to change.");
    expect(missing).toContain("This track has no guitar stem");
    // Unsupported asks explain themselves.
    const quieter = view({ text: "less drums", proposal: proposalFor("less drums") });
    expect(quieter).toContain("volume slider");
    expect(quieter).not.toContain(DESCRIBE_NOT_UNDERSTOOD.slice(0, 10));
  });

  it("confirms an Apply with a one-step Undo", () => {
    const html = view({ text: "slower", applied: true });
    expect(html).toContain(DESCRIBE_APPLIED_NOTE);
    expect(buttonTag(html, "remix-describe-undo")).not.toContain('disabled=""');
    expect(buttonTag(html, "remix-describe-undo")).toContain("bg-zinc-900");
    expect(view({ text: "slower" })).not.toContain("remix-describe-undo");
  });

  it("locks the box on a published remix", () => {
    const html = view({
      text: "slower",
      proposal: proposalFor("slower"),
      applied: false,
      locked: true,
    });
    expect(html).toMatch(/<input[^>]*disabled=""[^>]*remix-describe-input/);
    expect(buttonTag(html, "remix-describe-preview")).toContain('disabled=""');
    expect(buttonTag(html, "remix-describe-apply")).toContain('disabled=""');
    expect(
      buttonTag(view({ text: "x", applied: true, locked: true }), "remix-describe-undo"),
    ).toContain('disabled=""');
    const panel = render({ describeContext, onApplyEdits: noop, locked: true });
    expect(panel).toMatch(/<input[^>]*disabled=""[^>]*remix-describe-input/);
  });

  it("computes the proposal live from the current edits", () => {
    const slowed: RemixDescribeContext = {
      ...describeContext,
      edits: {
        ...describeContext.edits,
        effects: { schemaVersion: REMIX_FX_SCHEMA_VERSION, master: { speed: 0.85 } },
      },
    };
    const plan = parseRemixDescription("not so slow");
    expect(describeProposal(plan, describeContext).changes).toEqual([]);
    expect(describeProposal(plan, slowed).changes).toEqual([
      { label: "Speed", from: "0.85×", to: "1.00×" },
    ]);
  });
});
