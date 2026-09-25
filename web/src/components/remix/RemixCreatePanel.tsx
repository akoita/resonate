"use client";

import { useId } from "react";
import type { MouseEvent, ReactNode } from "react";
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
          <p className="text-xs text-zinc-400 remix-create-free-note">{STEM_MIX_FREE_NOTE}</p>
          <VibeSection
            effects={effects}
            onApplyVibe={onApplyVibe}
            onMasterFxChange={onMasterFxChange}
            locked={locked}
          />
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
