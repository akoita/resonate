"use client";

import { useId, useState } from "react";
import type { FormEvent, MouseEvent, ReactNode } from "react";
import {
  intentForSwitch,
  isAiIntent,
  REMIX_AI_INTENTS,
  type RemixIntent,
} from "../../lib/remixIntent";
import type { RemixRecipe } from "../../lib/remixRecipes";
import {
  activeVibeId,
  formatFxAmount,
  formatFxSpeed,
  formatFxTone,
  REMIX_FX_MASTER_RANGES,
  REMIX_VIBES,
  remixFxMaster,
  type RemixFxMaster,
  type RemixFxRecipe,
  type RemixVibeId,
} from "../../lib/remixFx";
import type { RemixSectionGrid } from "../../lib/api";
import {
  activeBeatPresetId,
  BEAT_PRESETS,
  beatPresetPattern,
  defaultBeat,
  REMIX_BEAT_INSTRUMENT_LABELS,
  REMIX_BEAT_INSTRUMENTS,
  REMIX_BEAT_KIT_IDS,
  REMIX_BEAT_KIT_LABELS,
  REMIX_BEAT_STEPS,
  REMIX_BEAT_SWING_RANGE,
  toggleBeatStep,
  type RemixBeatPresetId,
  type RemixBeatRecipe,
} from "../../lib/remixBeat";
import {
  formatSongLength,
  parseRemixDescription,
  planToEdits,
  REMIX_DESCRIBE_MAX_LENGTH,
  REMIX_DESCRIBE_SHAPE_LABELS,
  sameDescribeEdits,
  type RemixDescribeChange,
  type RemixDescribeContext,
  type RemixDescribeEdits,
  type RemixIntentPlan,
} from "../../lib/remixDescribe";
import {
  extendedMix,
  normalizeRemixStructure,
  REMIX_STRUCTURE_SCHEMA_VERSION,
  resetStructure,
  shortEdit,
  structureTimeline,
  structureTooLongReason,
  type RemixStructureEditResult,
  type RemixStructureEditState,
} from "../../lib/remixStructure";

export const REMIX_STUDIO_LOCKED_NOTE =
  "This remix is published — the studio is locked.";

export const STEM_MIX_FREE_NOTE =
  "Free — renders your arrangement exactly as you hear it.";

export type RemixCreatePrimaryAction = {
  label: string;
  enabled: boolean;
  /** Honest reason the action is unavailable, shown under the button. */
  reason: string | null;
  busy: boolean;
  onClick(): void;
};

export type RemixCreatePanelProps = {
  intent: RemixIntent;
  onIntentChange(intent: RemixIntent): void;
  prompt: string;
  onPromptChange(prompt: string): void;
  /** Prompt presets for the active intent's mode (presetsForMode). */
  presets: readonly { label: string; prompt: string }[];
  activePresetLabel: string | null;
  /** Separated stems the AI can replace (reference stems excluded). */
  replaceStemOptions: { stemId: string; name: string }[];
  replaceStemId: string | null;
  onReplaceStemChange(stemId: string | null): void;
  recipes: RemixRecipe[];
  onApplyRecipe(id: RemixRecipe["id"]): void;
  /** Effects recipe (#1897); the Vibe section edits its master controls. */
  effects: RemixFxRecipe | null;
  onApplyVibe(id: RemixVibeId): void;
  onMasterFxChange(key: keyof RemixFxMaster, value: number): void;
  /**
   * One-click song length & shape options (#1899); absent/empty = the
   * section is hidden (no section grid).
   */
  structureOptions?: RemixStructureShapeOption[];
  onApplyStructure?(id: RemixStructureShapeId): void;
  /**
   * "Describe it" (#1900): the current edits, stems and grid the proposal
   * is computed from; absent = the box is hidden.
   */
  describeContext?: RemixDescribeContext;
  /** Sets the described edits (Apply) or restores the previous ones (Undo). */
  onApplyEdits?(edits: RemixDescribeEdits): void;
  /**
   * Beat maker (#1902): the current beat (null = none) and whether the
   * track has a bar grid with a measured tempo. The "Add a beat" section
   * shows only with `onBeatChange`; it receives null to remove the beat.
   */
  beat?: RemixBeatRecipe | null;
  beatAvailable?: boolean;
  onBeatChange?(beat: RemixBeatRecipe | null): void;
  primary: RemixCreatePrimaryAction;
  creditMeter: ReactNode;
  attribution: ReactNode;
  /** Published remix: everything is read-only. */
  locked: boolean;
};

/** Whether the primary Create action may run right now. */
export function primaryActionable(
  primary: Pick<RemixCreatePrimaryAction, "enabled" | "busy">,
  locked: boolean,
): boolean {
  return primary.enabled && !primary.busy && !locked;
}

/**
 * Click handler for the primary action: an aria-disabled button stays
 * focusable and explains itself, but a click never runs the action.
 */
export function primaryClickHandler(
  primary: RemixCreatePrimaryAction,
  locked: boolean,
): (event: Pick<MouseEvent, "preventDefault">) => void {
  return (event) => {
    if (!primaryActionable(primary, locked)) {
      event.preventDefault();
      return;
    }
    primary.onClick();
  };
}

/** One-click structure shapes (#1899). */
export type RemixStructureShapeId = "original" | "extended" | "short";

export type RemixStructureShapeOption = {
  id: RemixStructureShapeId;
  label: string;
  description: string;
  /** The current structure already is this shape. */
  pressed: boolean;
  enabled: boolean;
  /** Honest reason when the shape can't be applied. */
  reason: string | null;
  /** Plain length change, e.g. "3:36 → 4:48"; just "4:48" when pressed. */
  lengthLabel: string | null;
};

export const REMIX_STRUCTURE_SHAPES: readonly {
  id: RemixStructureShapeId;
  label: string;
  description: string;
}[] = [
  {
    id: "original",
    label: REMIX_DESCRIBE_SHAPE_LABELS.original,
    description: "The song as released, in its original order",
  },
  {
    id: "extended",
    label: REMIX_DESCRIBE_SHAPE_LABELS.extended,
    description: "Longer intro and outro — handy for DJs",
  },
  {
    id: "short",
    label: REMIX_DESCRIBE_SHAPE_LABELS.short,
    description: "About a third shorter, fades out",
  },
];

// m:ss song lengths live with the describe diff, which shows them too.
export { formatSongLength } from "../../lib/remixDescribe";

function shapeOp(
  grid: RemixSectionGrid,
  state: RemixStructureEditState,
  id: RemixStructureShapeId,
): RemixStructureEditResult | null {
  switch (id) {
    case "original":
      return resetStructure(state, grid);
    case "extended":
      return extendedMix(grid, state);
    case "short":
      return shortEdit(grid, state);
  }
}

function currentStructureKey(
  grid: RemixSectionGrid,
  state: RemixStructureEditState,
): string {
  return JSON.stringify(
    normalizeRemixStructure(
      { schemaVersion: REMIX_STRUCTURE_SCHEMA_VERSION, blocks: state.blocks },
      grid.sections.length,
    ),
  );
}

/**
 * The structure edit for a shape (#1899); null when the shape is refused or
 * already applied (so re-pressing it never reshuffles the masks).
 */
export function structureShapeResult(
  grid: RemixSectionGrid,
  state: RemixStructureEditState,
  id: RemixStructureShapeId,
): RemixStructureEditResult | null {
  const result = shapeOp(grid, state, id);
  if (!result) return null;
  return JSON.stringify(result.structure) === currentStructureKey(grid, state)
    ? null
    : result;
}

/** The three shape buttons for the current structure (#1899). */
export function structureShapeOptions(
  grid: RemixSectionGrid,
  state: RemixStructureEditState,
): RemixStructureShapeOption[] {
  const current = currentStructureKey(grid, state);
  const currentSec = structureTimeline(grid, state.blocks).durationSec;
  return REMIX_STRUCTURE_SHAPES.map((shape) => {
    const result = shapeOp(grid, state, shape.id);
    if (!result) {
      return {
        ...shape,
        pressed: false,
        enabled: false,
        // Only the extended mix can be refused on a real grid: the cap.
        reason:
          shape.id === "extended" && grid.sections.length > 0
            ? structureTooLongReason(grid)
            : "Not available for this song",
        lengthLabel: null,
      };
    }
    const pressed = JSON.stringify(result.structure) === current;
    const nextSec = structureTimeline(grid, result.blocks).durationSec;
    return {
      ...shape,
      pressed,
      enabled: true,
      reason: null,
      lengthLabel: pressed
        ? formatSongLength(nextSec)
        : `${formatSongLength(currentSec)} → ${formatSongLength(nextSec)}`,
    };
  });
}

/**
 * Song length & shape (#1899): one-click structure options with the length
 * change spelled out.
 */
function StructureShapeSection({
  options,
  onApply,
  locked,
}: {
  options: RemixStructureShapeOption[];
  onApply(id: RemixStructureShapeId): void;
  locked: boolean;
}) {
  const labelId = `${useId()}-shape`;
  return (
    <div className="mt-4 remix-structure-shapes">
      <div className="text-xs text-zinc-500 mb-2" id={labelId}>
        Song length &amp; shape
      </div>
      <div className="grid gap-2" role="group" aria-labelledby={labelId}>
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={option.pressed}
            disabled={locked || !option.enabled}
            title={option.reason ?? undefined}
            className={`text-left rounded-md border px-3 py-2 transition-colors disabled:cursor-not-allowed disabled:opacity-60 remix-structure-shape-btn remix-structure-shape-${option.id} ${
              option.pressed
                ? "border-purple-500/60 bg-purple-500/15"
                : "border-zinc-700 bg-zinc-950 hover:border-purple-500/60 hover:bg-purple-500/10"
            }`}
            onClick={() => onApply(option.id)}
          >
            <span className="flex items-baseline justify-between gap-2">
              <span
                className={`text-sm ${option.pressed ? "text-purple-200" : "text-zinc-200"}`}
              >
                {option.label}
              </span>
              {option.lengthLabel && (
                <span className="shrink-0 text-xs tabular-nums text-zinc-400 remix-structure-shape-length">
                  {option.lengthLabel}
                </span>
              )}
            </span>
            <span className="block text-xs text-zinc-500">{option.description}</span>
            {option.reason && (
              <span className="block text-xs text-zinc-500 remix-structure-shape-reason">
                {option.reason}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// "Add a beat" (#1902): a code-synthesized drum kit, pattern presets, a
// 16-step grid and a groove (swing) control.

export const BEAT_NEEDS_TEMPO_NOTE =
  "The beat maker needs a measured tempo, and this track doesn't have one yet.";

/** Groove (swing) in plain words. */
export function formatBeatGroove(swing: number): string {
  if (!(swing > 0)) return "Straight";
  return `${Math.round((swing / REMIX_BEAT_SWING_RANGE.max) * 100)}% swung`;
}

/**
 * A preset press: a new beat with the Punchy kit, or the current beat with
 * the preset's pattern (kit, groove, level and blocks kept).
 */
export function beatAfterPreset(
  beat: RemixBeatRecipe | null,
  presetId: RemixBeatPresetId,
): RemixBeatRecipe {
  return beat
    ? { ...beat, pattern: beatPresetPattern(presetId) }
    : defaultBeat(presetId, "punchy");
}

export type BeatMakerViewProps = {
  /** Prefix for element ids (from useId in `BeatMakerSection`). */
  idPrefix: string;
  beat: RemixBeatRecipe | null;
  available: boolean;
  onChange(beat: RemixBeatRecipe | null): void;
  locked: boolean;
};

/** "Add a beat" (#1902) section; hook-free, every state renders from props. */
export function BeatMakerSection(props: Omit<BeatMakerViewProps, "idPrefix">) {
  return <BeatMakerView idPrefix={useId()} {...props} />;
}

export function BeatMakerView({
  idPrefix,
  beat,
  available,
  onChange,
  locked,
}: BeatMakerViewProps) {
  const labelId = `${idPrefix}-beat`;
  const presetsLabelId = `${idPrefix}-beat-presets`;
  const grooveId = `${idPrefix}-beat-groove`;
  const activePreset = activeBeatPresetId(beat);
  const choosePreset = (presetId: RemixBeatPresetId) => {
    if (locked) return;
    onChange(beatAfterPreset(beat, presetId));
  };
  return (
    <div className="mt-4 remix-beat-maker">
      <div className="text-xs text-zinc-500 mb-2" id={labelId}>
        Add a beat
      </div>
      {!available ? (
        <p className="text-xs text-zinc-400 remix-beat-needs-tempo">
          {BEAT_NEEDS_TEMPO_NOTE}
        </p>
      ) : (
        <div className="space-y-3" role="group" aria-labelledby={labelId}>
          {beat && (
            <div
              className="grid grid-cols-3 rounded-md border border-zinc-700 overflow-hidden remix-beat-kits"
              role="group"
              aria-label="Drum kit"
            >
              {REMIX_BEAT_KIT_IDS.map((kit) => {
                const active = beat.kit === kit;
                return (
                  <button
                    key={kit}
                    type="button"
                    aria-pressed={active}
                    disabled={locked}
                    className={`px-2 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 remix-beat-kit remix-beat-kit-${kit} ${
                      active
                        ? "bg-purple-500/25 text-purple-200"
                        : "bg-zinc-950 text-zinc-400 hover:text-zinc-200"
                    }`}
                    onClick={() => {
                      if (!locked) onChange({ ...beat, kit });
                    }}
                  >
                    {REMIX_BEAT_KIT_LABELS[kit]}
                  </button>
                );
              })}
            </div>
          )}
          <div>
            {beat && (
              <div className="text-[11px] text-zinc-500 mb-1" id={presetsLabelId}>
                Start from a pattern
              </div>
            )}
            <div
              className="grid grid-cols-2 gap-2 sm:grid-cols-3"
              role="group"
              aria-label={beat ? "Beat patterns" : "Choose a beat"}
            >
              {BEAT_PRESETS.map((preset) => {
                const active = preset.id === activePreset;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    aria-pressed={beat ? active : undefined}
                    disabled={locked}
                    title={preset.description}
                    className={`rounded-md border px-2 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 remix-beat-preset remix-beat-preset-${preset.id} ${
                      active
                        ? "border-purple-500/60 bg-purple-500/15 text-purple-200"
                        : "border-zinc-700 bg-zinc-950 text-zinc-200 hover:border-purple-500/60 hover:bg-purple-500/10"
                    }`}
                    onClick={() => choosePreset(preset.id)}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>
          {beat && (
            <>
              <BeatStepGrid beat={beat} locked={locked} onChange={onChange} />
              <div className="remix-beat-groove">
                <div className="flex items-baseline justify-between text-xs">
                  <label htmlFor={grooveId} className="text-zinc-300">
                    Groove
                  </label>
                  <span className="tabular-nums text-zinc-400">
                    {formatBeatGroove(beat.swing)}
                  </span>
                </div>
                <input
                  id={grooveId}
                  type="range"
                  min={REMIX_BEAT_SWING_RANGE.min}
                  max={REMIX_BEAT_SWING_RANGE.max}
                  step={0.05}
                  value={beat.swing}
                  disabled={locked}
                  aria-valuetext={formatBeatGroove(beat.swing)}
                  className="mt-1 h-1 w-full cursor-pointer accent-purple-400 disabled:cursor-not-allowed disabled:opacity-50"
                  onChange={(event) => {
                    if (!locked) {
                      onChange({ ...beat, swing: parseFloat(event.target.value) });
                    }
                  }}
                />
                <div
                  aria-hidden="true"
                  className="mt-0.5 flex justify-between text-[10px] text-zinc-500"
                >
                  <span>Straight</span>
                  <span>Swung</span>
                </div>
              </div>
              <button
                type="button"
                disabled={locked}
                className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1 text-sm text-zinc-300 transition-colors hover:border-red-500/60 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-50 remix-beat-remove"
                onClick={() => {
                  if (!locked) onChange(null);
                }}
              >
                Remove beat
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** The 5-row × 16-step grid; steps are grouped by beat (4 sixteenths). */
export function BeatStepGrid({
  beat,
  locked,
  onChange,
}: {
  beat: RemixBeatRecipe;
  locked: boolean;
  onChange(beat: RemixBeatRecipe): void;
}) {
  const quarters = Array.from({ length: REMIX_BEAT_STEPS / 4 }, (_, quarter) =>
    Array.from({ length: 4 }, (_, step) => quarter * 4 + step),
  );
  return (
    <div
      className="space-y-1 overflow-x-auto remix-beat-grid"
      role="group"
      aria-label="Beat steps"
    >
      {REMIX_BEAT_INSTRUMENTS.map((instrument) => {
        const label = REMIX_BEAT_INSTRUMENT_LABELS[instrument];
        const row = beat.pattern[instrument];
        return (
          <div
            key={instrument}
            className={`flex items-center gap-1.5 remix-beat-row remix-beat-row-${instrument}`}
          >
            <span className="w-14 shrink-0 text-[10px] text-zinc-400">{label}</span>
            <div className="flex flex-1 gap-1.5">
              {quarters.map((steps, quarter) => (
                <div key={quarter} className="flex flex-1 gap-0.5">
                  {steps.map((step) => {
                    const on = row[step] === true;
                    return (
                      <button
                        key={step}
                        type="button"
                        aria-pressed={on}
                        aria-label={`${label} step ${step + 1}`}
                        disabled={locked}
                        className={`h-5 min-w-[0.75rem] flex-1 rounded-sm border transition-colors disabled:cursor-not-allowed disabled:opacity-50 remix-beat-step ${
                          on
                            ? "border-purple-400/70 bg-purple-500/60 hover:bg-purple-500/70"
                            : quarter % 2 === 0
                              ? "border-zinc-700 bg-zinc-800 hover:bg-zinc-700"
                              : "border-zinc-700 bg-zinc-900 hover:bg-zinc-700"
                        }`}
                        onClick={() => {
                          if (!locked) onChange(toggleBeatStep(beat, instrument, step));
                        }}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// "Describe it" (#1900): plain words → a visible diff of control changes.

export const DESCRIBE_NOT_UNDERSTOOD =
  "I didn't catch that. Try words like slower, dreamy, darker, no drums, or longer.";
export const DESCRIBE_APPLIED_NOTE = "Applied — adjust anything below.";
export const DESCRIBE_PRIVACY_NOTE = "Understood on your device — nothing is sent.";

/** What the proposal shows for a parsed description. */
export type DescribeProposal = {
  /** Proposed edits (unchanged when there is nothing to change). */
  edits: RemixDescribeEdits;
  changes: RemixDescribeChange[];
  /** Missing parts, refused shapes and unsupported asks, in plain words. */
  skipped: string[];
  unrecognizedWords: string[];
  /** Whether any word was understood (a directive or an honest note). */
  understood: boolean;
};

/** The proposal for a plan against the current edits (pure). */
export function describeProposal(
  plan: RemixIntentPlan,
  context: RemixDescribeContext,
): DescribeProposal {
  const result = planToEdits(plan, context);
  return {
    edits: result.edits,
    changes: result.changes,
    skipped: [...result.skipped, ...plan.notes],
    unrecognizedWords: plan.unrecognizedWords,
    understood: plan.directives.length > 0 || plan.notes.length > 0,
  };
}

export type DescribeRemixViewProps = {
  text: string;
  onTextChange(text: string): void;
  onPreview(): void;
  proposal: DescribeProposal | null;
  onApply(): void;
  onCancel(): void;
  /** The last Apply is still in place and can be undone. */
  applied: boolean;
  onUndo(): void;
  locked: boolean;
};

/** Stateless "Describe it" box; every state renders from props. */
export function DescribeRemixView({
  text,
  onTextChange,
  onPreview,
  proposal,
  onApply,
  onCancel,
  applied,
  onUndo,
  locked,
}: DescribeRemixViewProps) {
  const id = useId();
  const inputId = `${id}-describe`;
  const privacyId = `${id}-describe-privacy`;
  const canPreview = !locked && text.trim().length > 0;
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (canPreview) onPreview();
  };
  const hasChanges = !!proposal && proposal.changes.length > 0;
  return (
    <form className="remix-describe" onSubmit={handleSubmit}>
      <label htmlFor={inputId} className="block text-xs text-zinc-500 mb-1">
        Describe the remix you want
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id={inputId}
          type="text"
          value={text}
          maxLength={REMIX_DESCRIBE_MAX_LENGTH}
          placeholder="e.g. slower and dreamy, no drums, longer"
          disabled={locked}
          autoComplete="off"
          aria-describedby={privacyId}
          className="min-w-[12rem] flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-purple-500/60 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 remix-describe-input"
          onChange={(event) =>
            onTextChange(event.target.value.slice(0, REMIX_DESCRIBE_MAX_LENGTH))
          }
        />
        <button
          type="submit"
          disabled={!canPreview}
          className="shrink-0 rounded-md border border-purple-500/60 bg-purple-500/15 px-3 py-1.5 text-sm text-purple-200 transition-colors hover:bg-purple-500/25 disabled:cursor-not-allowed disabled:opacity-50 remix-describe-preview"
        >
          Preview changes
        </button>
      </div>
      <p id={privacyId} className="mt-1 text-xs text-zinc-500 remix-describe-privacy">
        {DESCRIBE_PRIVACY_NOTE}
      </p>
      <div aria-live="polite" className="remix-describe-proposal">
        {proposal && (
          <div className="mt-2 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2">
            {hasChanges ? (
              <>
                <div className="text-xs text-zinc-500">Proposed changes</div>
                <ul className="mt-1 space-y-0.5 text-sm remix-describe-changes">
                  {proposal.changes.map((change, index) => (
                    <li
                      key={`${change.label}-${index}`}
                      className="flex items-baseline justify-between gap-2 remix-describe-change"
                    >
                      <span className="text-zinc-300">{change.label}</span>
                      <span className="shrink-0 tabular-nums text-zinc-400">
                        {change.from} <span aria-hidden="true">→</span>
                        <span className="sr-only">to</span>{" "}
                        <span className="text-purple-200">{change.to}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : proposal.understood ? (
              <p className="text-sm text-zinc-300 remix-describe-nothing">
                {proposal.skipped.length > 0
                  ? "Nothing to change."
                  : "Nothing to change — it already sounds like that."}
              </p>
            ) : (
              <p className="text-sm text-zinc-300 remix-describe-not-understood">
                {DESCRIBE_NOT_UNDERSTOOD}
              </p>
            )}
            {proposal.skipped.map((note) => (
              <p key={note} className="mt-1 text-xs text-zinc-500 remix-describe-skipped">
                {note}
              </p>
            ))}
            {proposal.understood && proposal.unrecognizedWords.length > 0 && (
              <p className="mt-1 text-xs text-zinc-500 remix-describe-unrecognized">
                Not understood: {proposal.unrecognizedWords.join(", ")}
              </p>
            )}
            <div className="mt-2 flex gap-2">
              {hasChanges && (
                <button
                  type="button"
                  disabled={locked}
                  className="rounded-md border border-purple-400 bg-purple-600 px-3 py-1 text-sm font-medium text-white transition-colors hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50 remix-describe-apply"
                  onClick={onApply}
                >
                  Apply
                </button>
              )}
              <button
                type="button"
                className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1 text-sm text-zinc-300 transition-colors hover:border-zinc-500 hover:text-zinc-100 remix-describe-cancel"
                onClick={onCancel}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {!proposal && applied && (
          <p className="mt-2 flex items-center justify-between gap-2 text-xs text-zinc-400 remix-describe-applied">
            <span>{DESCRIBE_APPLIED_NOTE}</span>
            <button
              type="button"
              disabled={locked}
              className="shrink-0 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-xs text-zinc-300 transition-colors hover:border-zinc-500 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 remix-describe-undo"
              onClick={onUndo}
            >
              Undo
            </button>
          </p>
        )}
      </div>
    </form>
  );
}

/**
 * "Describe it" (#1900): the listener's words become a proposal computed
 * live from the current edits; nothing changes until Apply, and one Undo
 * restores the edits from before the last Apply while they are unchanged.
 */
function DescribeRemixSection({
  context,
  onApplyEdits,
  locked,
}: {
  context: RemixDescribeContext;
  onApplyEdits(edits: RemixDescribeEdits): void;
  locked: boolean;
}) {
  const [text, setText] = useState("");
  const [plan, setPlan] = useState<RemixIntentPlan | null>(null);
  const [applied, setApplied] = useState<{
    before: RemixDescribeEdits;
    after: RemixDescribeEdits;
  } | null>(null);
  const proposal = plan ? describeProposal(plan, context) : null;
  // Undo is only offered while the applied edits are still in place.
  const undoable = !!applied && sameDescribeEdits(context.edits, applied.after);
  return (
    <DescribeRemixView
      text={text}
      onTextChange={(next) => {
        setText(next);
        setPlan(null);
      }}
      onPreview={() => {
        if (locked) return;
        setPlan(parseRemixDescription(text));
        setApplied(null);
      }}
      proposal={proposal}
      onApply={() => {
        if (locked || !proposal || proposal.changes.length === 0) return;
        onApplyEdits(proposal.edits);
        setApplied({ before: context.edits, after: proposal.edits });
        setPlan(null);
      }}
      onCancel={() => setPlan(null)}
      applied={undoable}
      onUndo={() => {
        if (locked || !applied) return;
        onApplyEdits(applied.before);
        setApplied(null);
      }}
      locked={locked}
    />
  );
}

type MasterControl = {
  key: keyof RemixFxMaster;
  label: string;
  step: number;
  low: string;
  high: string;
  /** Label under the default position (speed's "Original"). */
  center?: string;
  format(value: number): string;
};

/** The four master controls, in plain language (#1897). */
export const VIBE_MASTER_CONTROLS: readonly MasterControl[] = [
  {
    key: "speed",
    label: "Speed",
    step: 0.01,
    low: "Slowed",
    high: "Sped up",
    center: "Original",
    format: formatFxSpeed,
  },
  { key: "space", label: "Space", step: 0.01, low: "Dry", high: "Roomy", format: formatFxAmount },
  { key: "tone", label: "Tone", step: 0.01, low: "Darker", high: "Brighter", format: formatFxTone },
  { key: "warmth", label: "Warmth", step: 0.01, low: "Clean", high: "Warm", format: formatFxAmount },
];

/**
 * Vibe section (#1897): one-click vibe starters plus the four master
 * controls they set, so every vibe stays visible and tweakable.
 */
function VibeSection({
  effects,
  onApplyVibe,
  onMasterFxChange,
  locked,
}: Pick<
  RemixCreatePanelProps,
  "effects" | "onApplyVibe" | "onMasterFxChange" | "locked"
>) {
  const id = useId();
  const labelId = `${id}-vibe`;
  const activeId = activeVibeId(effects);
  const activeVibe = REMIX_VIBES.find((vibe) => vibe.id === activeId) ?? null;
  const master = remixFxMaster(effects);
  return (
    <div className="mt-4 remix-vibe">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div className="text-xs text-zinc-500" id={labelId}>
          Vibe
        </div>
        <div className="text-xs text-zinc-400 remix-vibe-active" aria-live="polite">
          {activeVibe ? activeVibe.label : "Custom"}
        </div>
      </div>
      <div
        className="grid grid-cols-2 gap-2 sm:grid-cols-3"
        role="group"
        aria-labelledby={labelId}
      >
        {REMIX_VIBES.map((vibe) => {
          const active = vibe.id === activeId;
          return (
            <button
              key={vibe.id}
              type="button"
              disabled={locked}
              aria-pressed={active}
              title={vibe.description}
              className={`rounded-md border px-2 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 remix-vibe-btn remix-vibe-${vibe.id} ${
                active
                  ? "border-purple-500/60 bg-purple-500/15 text-purple-200"
                  : "border-zinc-700 bg-zinc-950 text-zinc-200 hover:border-purple-500/60 hover:bg-purple-500/10"
              }`}
              onClick={() => onApplyVibe(vibe.id)}
            >
              {vibe.label}
            </button>
          );
        })}
      </div>
      <div className="mt-3 space-y-3 remix-vibe-controls">
        {VIBE_MASTER_CONTROLS.map((control) => {
          const range = REMIX_FX_MASTER_RANGES[control.key];
          const value = master[control.key];
          const inputId = `${id}-${control.key}`;
          return (
            <div key={control.key} className={`remix-vibe-control remix-vibe-control-${control.key}`}>
              <div className="flex items-baseline justify-between text-xs">
                <label htmlFor={inputId} className="text-zinc-300">
                  {control.label}
                </label>
                <span className="tabular-nums text-zinc-400">
                  {control.format(value)}
                </span>
              </div>
              <input
                id={inputId}
                type="range"
                min={range.min}
                max={range.max}
                step={control.step}
                value={value}
                disabled={locked}
                aria-valuetext={control.format(value)}
                className="mt-1 h-1 w-full cursor-pointer accent-purple-400 disabled:cursor-not-allowed disabled:opacity-50"
                onChange={(event) =>
                  onMasterFxChange(control.key, parseFloat(event.target.value))
                }
              />
              <div
                aria-hidden="true"
                className="mt-0.5 grid grid-cols-3 text-[10px] text-zinc-500"
              >
                <span>{control.low}</span>
                <span className="text-center">{control.center ?? ""}</span>
                <span className="text-right">{control.high}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const SWITCH_BUTTON =
  "px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed";

export function RemixCreatePanel(props: RemixCreatePanelProps) {
  const {
    intent,
    onIntentChange,
    prompt,
    onPromptChange,
    presets,
    activePresetLabel,
    replaceStemOptions,
    replaceStemId,
    onReplaceStemChange,
    recipes,
    onApplyRecipe,
    effects,
    onApplyVibe,
    onMasterFxChange,
    structureOptions,
    onApplyStructure,
    describeContext,
    onApplyEdits,
    beat,
    beatAvailable,
    onBeatChange,
    primary,
    creditMeter,
    attribution,
    locked,
  } = props;
  const ai = isAiIntent(intent);
  const actionable = primaryActionable(primary, locked);
  // When locked, the note at the top of the panel is the reason.
  const primaryReason = locked ? null : primary.reason;
  const id = useId();
  const headingId = `${id}-heading`;
  const lockedId = `${id}-locked`;
  const recipesLabelId = `${id}-recipes`;
  const replaceId = `${id}-replace`;
  const promptId = `${id}-prompt`;
  const reasonId = `${id}-reason`;
  const intentDescriptionId = `${id}-intent-description`;
  const activeIntent = REMIX_AI_INTENTS.find((entry) => entry.intent === intent) ?? null;

  return (
    <section
      className="bg-zinc-900 border border-zinc-800 rounded-lg p-5 remix-create-panel"
      aria-labelledby={headingId}
    >
      <h2 id={headingId} className="text-lg font-semibold text-white mb-3">
        Create
      </h2>
      {locked && (
        <p
          id={lockedId}
          className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200 remix-create-locked">
          {REMIX_STUDIO_LOCKED_NOTE}
        </p>
      )}

      <div
        className="grid grid-cols-2 rounded-md border border-zinc-700 overflow-hidden remix-create-switch"
        role="group"
        aria-label="What to create"
      >
        {(
          [
            { side: "mix", label: "Mix stems" },
            { side: "ai", label: "Add AI" },
          ] as const
        ).map((option) => {
          const active = option.side === "ai" ? ai : !ai;
          return (
            <button
              key={option.side}
              type="button"
              aria-pressed={active}
              disabled={locked}
              className={`${SWITCH_BUTTON} remix-create-switch-${option.side} ${
                active
                  ? "bg-purple-500/25 text-purple-200"
                  : "bg-zinc-900 text-zinc-400 hover:text-zinc-200"
              }`}
              onClick={() => onIntentChange(intentForSwitch(option.side, intent))}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      {!ai ? (
        <div className="mt-4 remix-create-mix">
          {describeContext && onApplyEdits && (
            <div className="mb-4">
              <DescribeRemixSection
                context={describeContext}
                onApplyEdits={onApplyEdits}
                locked={locked}
              />
            </div>
          )}
          <p className="text-xs text-zinc-400 remix-create-free-note">{STEM_MIX_FREE_NOTE}</p>
          <VibeSection
            effects={effects}
            onApplyVibe={onApplyVibe}
            onMasterFxChange={onMasterFxChange}
            locked={locked}
          />
          {structureOptions && structureOptions.length > 0 && onApplyStructure && (
            <StructureShapeSection
              options={structureOptions}
              onApply={onApplyStructure}
              locked={locked}
            />
          )}
          {onBeatChange && (
            <BeatMakerSection
              beat={beat ?? null}
              available={beatAvailable ?? false}
              onChange={onBeatChange}
              locked={locked}
            />
          )}
          {recipes.length > 0 && (
            <div className="mt-4">
              <div className="text-xs text-zinc-500 mb-2" id={recipesLabelId}>
                One-click arrangements
              </div>
              <div
                className="grid gap-2 sm:grid-cols-2"
                role="group"
                aria-labelledby={recipesLabelId}
              >
                {recipes.map((recipe) => (
                  <button
                    key={recipe.id}
                    type="button"
                    disabled={locked}
                    className="text-left rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 transition-colors hover:border-purple-500/60 hover:bg-purple-500/10 disabled:cursor-not-allowed disabled:opacity-60 remix-recipe-btn"
                    onClick={() => onApplyRecipe(recipe.id)}
                  >
                    <span className="block text-sm text-zinc-200">{recipe.label}</span>
                    <span className="block text-xs text-zinc-500">{recipe.description}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-4 remix-create-ai">
          {/* One compact line per intent; only the selected intent's
              description is shown, once, as helper text (#1879 layout). */}
          <div
            role="radiogroup"
            aria-label="AI intent"
            aria-describedby={activeIntent ? intentDescriptionId : undefined}
            className="space-y-1.5 remix-intents"
          >
            {REMIX_AI_INTENTS.map((entry) => {
              const active = entry.intent === intent;
              return (
                <label
                  key={entry.intent}
                  className={`flex min-h-9 items-center rounded-md border px-3 py-1.5 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-purple-300 remix-intent remix-intent-${entry.intent} ${
                    locked ? "cursor-not-allowed opacity-60" : "cursor-pointer"
                  } ${
                    active
                      ? "border-purple-500/60 bg-purple-500/15 text-purple-200"
                      : "border-zinc-700 bg-zinc-950 text-zinc-200 hover:border-zinc-500"
                  }`}
                >
                  <input
                    type="radio"
                    name={`${id}-intent`}
                    value={entry.intent}
                    className="sr-only"
                    checked={active}
                    disabled={locked}
                    onChange={() => onIntentChange(entry.intent)}
                  />
                  <span className="truncate">{entry.label}</span>
                </label>
              );
            })}
          </div>
          {activeIntent && (
            <p
              id={intentDescriptionId}
              className="mt-2 text-xs text-zinc-500 remix-intent-description"
            >
              {activeIntent.description}
            </p>
          )}

          {intent === "replace_stem" && (
            <div className="mt-3 remix-replace-stem">
              <label className="block text-xs text-zinc-500 mb-1" htmlFor={replaceId}>
                Stem to replace
              </label>
              <select
                id={replaceId}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-md px-2 py-1.5 text-sm text-zinc-200 disabled:opacity-60"
                value={replaceStemId ?? ""}
                disabled={locked}
                onChange={(event) => onReplaceStemChange(event.target.value || null)}
              >
                <option value="">Choose stem…</option>
                {replaceStemOptions.map((option) => (
                  <option key={option.stemId} value={option.stemId}>
                    {option.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="mt-3">
            <label className="block text-sm text-zinc-400 mb-1" htmlFor={promptId}>
              Prompt
            </label>
            {/* Presets are transparent templates (#1177): a click fills the
                editable textarea with the full text, never a hidden augmentation. */}
            {presets.length > 0 && (
              <div
                className="flex items-center gap-2 flex-wrap mb-2"
                role="group"
                aria-label="Prompt presets"
              >
                {presets.map((preset) => {
                  const active = activePresetLabel === preset.label;
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      disabled={locked}
                      aria-pressed={active}
                      title={preset.prompt}
                      className={`px-3 py-1 rounded-full text-xs border transition-colors disabled:cursor-not-allowed remix-prompt-preset ${
                        active
                          ? "border-purple-500/60 bg-purple-500/15 text-purple-200"
                          : "border-zinc-700 bg-zinc-950 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500"
                      }`}
                      onClick={() => onPromptChange(preset.prompt)}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
            )}
            <textarea
              id={promptId}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-md p-3 text-sm text-zinc-200 disabled:opacity-50"
              rows={3}
              placeholder="Describe the sound you want…"
              value={prompt}
              disabled={locked}
              onChange={(event) => onPromptChange(event.target.value)}
            />
          </div>

          {creditMeter && <div className="mt-2 remix-create-credits">{creditMeter}</div>}
          {attribution}
        </div>
      )}

      <div className="mt-4">
        <button
          type="button"
          className="ui-btn ui-btn-primary w-full remix-generate-btn"
          aria-disabled={!actionable || undefined}
          aria-busy={primary.busy || undefined}
          aria-describedby={
            locked ? lockedId : primaryReason ? reasonId : undefined
          }
          onClick={primaryClickHandler(primary, locked)}
        >
          {primary.label}
        </button>
        {primaryReason && (
          <p id={reasonId} className="mt-2 text-xs text-zinc-500 remix-create-reason">
            {primaryReason}
          </p>
        )}
      </div>
    </section>
  );
}
