"use client";

import { useId } from "react";
import { ApiRequestError, type RemixPartTake } from "../../lib/api";
import {
  partLengthSeconds,
  REMIX_PART_ROLES,
  REMIX_PARTS_MAX,
  type RemixPart,
  type RemixPartRole,
} from "../../lib/remixParts";
import { peaksToSvgPath } from "./RemixSessionLanes";

/**
 * "Add a part" (#1901): the primary AI path of the Create panel. The
 * listener picks one instrument, 4 or 8 bars and optional style words; the
 * studio generates 3 AI takes locked to the song's tempo and key, the
 * listener auditions them over the arrangement and places one as a lane.
 * Every take is one 30 s AI generation at the canonical per-30 s price
 * (ADR-BM-6 line 2); the quote is shown before anything is spent.
 *
 * The view is hook-free apart from `useId` in the wrapper, so tests render
 * every state from props; the editor owns the data and the requests.
 */

export const REMIX_PART_ROLE_LABELS: Record<RemixPartRole, string> = {
  drums: "Drums",
  bass: "Bass",
  keys: "Keys",
  pad: "Pad",
  strings: "Strings",
  guitar: "Guitar",
};

/** A part lane's name, always AI-labelled: "AI Bass". */
export function partLaneName(role: string): string {
  const label = REMIX_PART_ROLE_LABELS[role as RemixPartRole] ?? role;
  return `AI ${label}`;
}

export const PART_BARS_OPTIONS = [4, 8] as const;
export type PartBars = (typeof PART_BARS_OPTIONS)[number];
/** Style words: the backend's cap (characters). */
export const PART_STYLE_MAX_CHARS = 80;
/** Takes per batch (the backend default). */
export const PART_TAKES_PER_BATCH = 3;
/**
 * The longest part a take can hold (seconds): one 30 s generation, minus the
 * downbeat search start. Mirrors the backend `PART_MAX_LENGTH_SECONDS`.
 */
export const PART_MAX_LENGTH_SECONDS = 30 - 0.25;
/** Most takes a project keeps (the backend limit). */
export const PART_TAKES_PER_PROJECT_MAX = 24;
/** Tray id: "Try other takes" on a lane moves focus here. */
export const PARTS_TRAY_ID = "remix-parts-tray";

export const PARTS_INTRO =
  "An AI musician plays one instrument over your remix, locked to the song's tempo and key. You hear 3 takes and keep the one you like.";
export const PARTS_NEED_TEMPO_NOTE =
  "AI parts need a measured tempo to lock to, and this track doesn't have one yet.";
export const PARTS_LOCKED_REASON = "Published remixes are locked.";
export const PARTS_BATCH_ACTIVE_REASON =
  "Your takes are still being made. Wait for them to finish.";
export const PARTS_CHECKING_CREDITS_REASON = "Checking your credits…";
export const PARTS_UNSUPPORTED_REASON =
  "The AI service on this site can't make single-instrument parts yet.";
export const PARTS_DISABLED_REASON =
  "AI generation is switched off on this site right now.";
export const PART_PICKUP_REASON =
  "AI parts don't play in the pickup, the short lead-in before the first full bar.";

/** Cents in plain money: "30¢" under a dollar, "$1.20" from one. */
export function formatCents(cents: number): string {
  const whole = Math.max(0, Math.round(cents));
  return whole < 100 ? `${whole}¢` : `$${(whole / 100).toFixed(2)}`;
}

/** The quote: takes × the per-30 s generation price (one 30 s clip per take). */
export function partsQuoteCents(priceCentsPer30s: number, takes = PART_TAKES_PER_BATCH): number {
  return Math.max(0, takes) * Math.max(0, priceCentsPer30s);
}

/** "3 takes · 30¢ · you have 70¢"; without a balance, the quote alone. */
export function partsMoneyLine(input: {
  priceCentsPer30s: number;
  balanceCents: number | null;
  takes?: number;
}): string {
  const takes = input.takes ?? PART_TAKES_PER_BATCH;
  const parts = [
    `${takes} takes`,
    formatCents(partsQuoteCents(input.priceCentsPer30s, takes)),
  ];
  if (input.balanceCents !== null) parts.push(`you have ${formatCents(input.balanceCents)}`);
  return parts.join(" · ");
}

/**
 * Why `bars` bars can't be generated at the song's tempo, or null: a take is
 * one 30 s clip, so a slow song's 8 bars may not fit (the backend's
 * `part_too_long`).
 */
export function partBarsReason(bpm: number | null, bars: number): string | null {
  if (bpm === null || !(bpm > 0)) return null;
  if (partLengthSeconds(bpm, bars) <= PART_MAX_LENGTH_SECONDS) return null;
  return `At this song's tempo, ${bars} bars last longer than one AI take (30 seconds). Pick fewer bars.`;
}

export type PartsGenerateAvailability = {
  enabled: boolean;
  /** Honest reason when disabled; null when enabled or just busy. */
  reason: string | null;
  /** The reason is a short balance: offer the credit request. */
  needsCredits: boolean;
};

/**
 * Whether "Generate 3 takes" may run, and the plain reason when not: locked,
 * parts unavailable on this site, no tempo grid, too many bars for the
 * tempo, a batch still generating, the balance unknown or short.
 */
export function describePartsGenerate(input: {
  locked: boolean;
  unavailableReason: string | null;
  bpm: number | null;
  bars: number;
  /** The generate request is in flight. */
  generating: boolean;
  /** A take of this project is still pending or processing. */
  batchActive: boolean;
  credits: { balanceCents: number; priceCentsPer30s: number } | null;
  takes?: number;
}): PartsGenerateAvailability {
  const off = (reason: string | null, needsCredits = false) => ({
    enabled: false,
    reason,
    needsCredits,
  });
  if (input.locked) return off(PARTS_LOCKED_REASON);
  if (input.unavailableReason) return off(input.unavailableReason);
  if (input.bpm === null || !(input.bpm > 0)) return off(PARTS_NEED_TEMPO_NOTE);
  const barsReason = partBarsReason(input.bpm, input.bars);
  if (barsReason) return off(barsReason);
  if (input.generating) return off(null);
  if (input.batchActive) return off(PARTS_BATCH_ACTIVE_REASON);
  if (!input.credits) return off(PARTS_CHECKING_CREDITS_REASON);
  const takes = input.takes ?? PART_TAKES_PER_BATCH;
  const quote = partsQuoteCents(input.credits.priceCentsPer30s, takes);
  if (input.credits.balanceCents < quote) {
    return off(
      `You need ${formatCents(quote)} of credits for ${takes} takes, and you have ${formatCents(input.credits.balanceCents)}.`,
      true,
    );
  }
  return { enabled: true, reason: null, needsCredits: false };
}

/** The status and machine code of a failed API call, when known. */
export function apiErrorCode(error: unknown): { status: number | null; code: string | null } {
  let status: number | null = null;
  let code: string | null = null;
  if (error instanceof ApiRequestError) {
    status = error.status;
    const details = error.details as { code?: unknown } | undefined;
    if (details && typeof details.code === "string") code = details.code;
  } else if (error instanceof Error) {
    const match = error.message.match(/^API (\d{3}):/);
    if (match) status = Number(match[1]);
  }
  return { status, code };
}

/**
 * A failed "Generate 3 takes" in plain words. `sticky` = the site can't make
 * parts at all right now, so the button stays off with that reason.
 */
export function partsGenerateErrorMessage(error: unknown): {
  message: string;
  sticky: boolean;
} {
  const { status, code } = apiErrorCode(error);
  switch (code) {
    case "parts_unsupported":
      return { message: PARTS_UNSUPPORTED_REASON, sticky: true };
    case "provider_disabled":
      return { message: PARTS_DISABLED_REASON, sticky: true };
    case "part_too_long":
      return {
        message:
          "At this song's tempo, that many bars last longer than one AI take. Pick fewer bars.",
        sticky: false,
      };
    case "no_tempo_grid":
      return { message: PARTS_NEED_TEMPO_NOTE, sticky: false };
    case "take_limit_reached":
      return {
        message: `This remix already keeps the most takes it can (${PART_TAKES_PER_PROJECT_MAX}). Delete takes you don't use, or wait for the ones being made to finish.`,
        sticky: false,
      };
    case "prompt_rejected":
      return {
        message: "Those style words can't be used. Try different ones.",
        sticky: false,
      };
    case "project_published":
    case "project_not_draft":
      return { message: PARTS_LOCKED_REASON, sticky: false };
    case "insufficient_credits":
      return {
        message:
          "You don't have enough credits for these takes. Request credits, then try again.",
        sticky: false,
      };
    case "provider_unavailable":
      return {
        message: "The AI service is busy right now. Please try again in a few minutes.",
        sticky: false,
      };
    default:
      break;
  }
  switch (status) {
    case 402:
      return {
        message:
          "You don't have enough credits for these takes. Request credits, then try again.",
        sticky: false,
      };
    case 403:
      return {
        message:
          "AI parts aren't allowed for this song right now. Its rights or consent may have changed.",
        sticky: false,
      };
    case 429:
      return {
        message: "You're making takes a bit too quickly. Wait a moment, then try again.",
        sticky: false,
      };
    case 503:
      return {
        message: "The AI service is busy right now. Please try again in a few minutes.",
        sticky: false,
      };
    default:
      return { message: "Couldn't start the takes. Please try again.", sticky: false };
  }
}

/** Failure codes stored before the take was charged: nothing to refund. */
const NOT_CHARGED_CODES = new Set([
  "invalid_input",
  "project_not_draft",
  "not_eligible",
  "insufficient_credits",
  "queue_unavailable",
]);

/** A failed take's safe error code in plain words. */
export function takeFailureDetail(code: string | null | undefined): string {
  switch (code) {
    case "provider_disabled":
      return "AI generation was switched off.";
    case "provider_rejected":
      return "The AI service turned this request down. Try different style words.";
    case "provider_unavailable":
      return "The AI service was busy.";
    case "invalid_input":
      return "The request wasn't valid.";
    case "parts_unsupported":
      return "The AI service here can't make single-instrument parts.";
    case "no_tempo_grid":
      return "The song has no measured tempo.";
    case "not_eligible":
      return "AI parts aren't allowed for this song right now.";
    case "project_not_draft":
      return "The remix was published.";
    case "insufficient_credits":
      return "You ran out of credits.";
    case "conform_failed":
      return "The take couldn't be locked to the song's tempo.";
    default:
      return "Something went wrong on our side.";
  }
}

export type PartTakeState = "generating" | "ready" | "failed";

export function partTakeState(status: string): PartTakeState {
  if (status === "completed") return "ready";
  if (status === "failed") return "failed";
  return "generating";
}

/** "Generating…", "Ready", or "Didn't work, credit refunded" (or not charged). */
export function takeStatusLabel(take: Pick<RemixPartTake, "status" | "errorCode">): string {
  const state = partTakeState(take.status);
  if (state === "generating") return "Generating…";
  if (state === "ready") return "Ready";
  return NOT_CHARGED_CODES.has(take.errorCode ?? "")
    ? "Didn't work, not charged"
    : "Didn't work, credit refunded";
}

export type PartTakeBatch = {
  batchId: string;
  role: string;
  bars: number;
  style: string | null;
  /** In generation order: Take 1, 2, 3. */
  takes: Array<{ take: RemixPartTake; number: number }>;
};

function byCreatedAt(left: RemixPartTake, right: RemixPartTake): number {
  return left.createdAt === right.createdAt
    ? left.id.localeCompare(right.id)
    : left.createdAt < right.createdAt
      ? -1
      : 1;
}

/**
 * The takes of one role grouped by batch, newest batch first; takes in a
 * batch in generation order, numbered from 1.
 */
export function partTakeBatches(
  takes: readonly RemixPartTake[],
  role: string,
): PartTakeBatch[] {
  const batches = new Map<string, RemixPartTake[]>();
  for (const take of takes) {
    if (take.role !== role) continue;
    const list = batches.get(take.batchId) ?? [];
    list.push(take);
    batches.set(take.batchId, list);
  }
  return [...batches.entries()]
    .map(([batchId, list]) => {
      const sorted = [...list].sort(byCreatedAt);
      return {
        batchId,
        role,
        bars: sorted[0].bars,
        style: sorted[0].style,
        takes: sorted.map((take, index) => ({ take, number: index + 1 })),
        newest: sorted[sorted.length - 1].createdAt,
      };
    })
    .sort((left, right) => (left.newest < right.newest ? 1 : left.newest > right.newest ? -1 : 0))
    .map((batch) => ({
      batchId: batch.batchId,
      role: batch.role,
      bars: batch.bars,
      style: batch.style,
      takes: batch.takes,
    }));
}

/** A take's number in its batch ("Take 2"), or null when unknown. */
export function partTakeNumber(
  takes: readonly RemixPartTake[],
  takeId: string,
): number | null {
  const take = takes.find((entry) => entry.id === takeId);
  if (!take) return null;
  for (const batch of partTakeBatches(takes, take.role)) {
    const found = batch.takes.find((entry) => entry.take.id === takeId);
    if (found) return found.number;
  }
  return null;
}

/** Whether any take is still being made (drives polling and the gate). */
export function partTakesActive(takes: readonly RemixPartTake[] | null | undefined): boolean {
  return (takes ?? []).some((take) => partTakeState(take.status) === "generating");
}

/**
 * What "Use this take" does: swap the take of the lane that opened the tray
 * ("Try other takes"), else of the lane already playing this instrument;
 * otherwise add a lane — unless the remix already has the most parts.
 * `current` = that lane already plays this take.
 */
export type PartUseTarget =
  | { kind: "replace"; part: RemixPart }
  | { kind: "current"; part: RemixPart }
  | { kind: "add" }
  | { kind: "full" };

export function partUseTarget(
  take: Pick<RemixPartTake, "id" | "role">,
  parts: readonly RemixPart[],
  targetPartId: string | null,
): PartUseTarget {
  const targeted =
    targetPartId !== null
      ? parts.find((part) => part.id === targetPartId && part.role === take.role)
      : undefined;
  const lane = targeted ?? parts.find((part) => part.role === take.role);
  if (lane) {
    return lane.takeId === take.id ? { kind: "current", part: lane } : { kind: "replace", part: lane };
  }
  return parts.length >= REMIX_PARTS_MAX ? { kind: "full" } : { kind: "add" };
}

export const PARTS_FULL_REASON = `You already have ${REMIX_PARTS_MAX} AI parts, the most a remix can hold. Remove one to add another.`;

/** "Use this take" state: label, whether it acts, and the plain reason/effect. */
export function takeUseAction(
  target: PartUseTarget,
  locked: boolean,
): { label: string; enabled: boolean; note: string | null } {
  if (locked) return { label: "Use this take", enabled: false, note: PARTS_LOCKED_REASON };
  switch (target.kind) {
    case "current":
      return {
        label: "In use",
        enabled: false,
        note: `The ${partLaneName(target.part.role)} lane already plays this take.`,
      };
    case "full":
      return { label: "Use this take", enabled: false, note: PARTS_FULL_REASON };
    case "replace":
      return {
        label: "Use this take",
        enabled: true,
        note: `Replaces the take in the ${partLaneName(target.part.role)} lane.`,
      };
    case "add":
      return { label: "Use this take", enabled: true, note: null };
  }
}

/** Whether a take can be deleted, and why not. */
export function takeDeleteAvailability(
  take: Pick<RemixPartTake, "id" | "status">,
  inUseTakeIds: ReadonlySet<string>,
  locked: boolean,
): { enabled: boolean; reason: string | null } {
  if (locked) return { enabled: false, reason: PARTS_LOCKED_REASON };
  if (partTakeState(take.status) === "generating") {
    return { enabled: false, reason: "This take is still being made." };
  }
  if (inUseTakeIds.has(take.id)) {
    return {
      enabled: false,
      reason: "A lane uses this take. Remove the lane or pick another take first.",
    };
  }
  return { enabled: true, reason: null };
}

export const DELETE_TAKE_CONFIRM_TITLE = "Delete this take?";
export const DELETE_TAKE_CONFIRM_MESSAGE =
  "The take and its audio are deleted for good. Credits spent on it are not returned.";

/** The tray's live summary of the newest batch, for screen readers. */
export function trayStatusText(batches: readonly PartTakeBatch[]): string {
  const newest = batches[0];
  if (!newest) return "";
  const generating = newest.takes.filter(
    (entry) => partTakeState(entry.take.status) === "generating",
  ).length;
  if (generating > 0) return `Generating ${generating} of ${newest.takes.length} takes…`;
  const ready = newest.takes.filter(
    (entry) => partTakeState(entry.take.status) === "ready",
  ).length;
  return ready === 1 ? "1 take ready." : `${ready} takes ready.`;
}

export type RemixPartsModel = {
  role: RemixPartRole;
  bars: PartBars;
  style: string;
  onRoleChange(role: RemixPartRole): void;
  onBarsChange(bars: PartBars): void;
  onStyleChange(style: string): void;
  /** The bar grid's tempo; null = no tempo grid (parts unavailable). */
  bpm: number | null;
  /** Balance and the per-30 s price from the credits endpoint; null = loading. */
  credits: { balanceCents: number; priceCentsPer30s: number } | null;
  creditRequest: "idle" | "sending" | "sent";
  onRequestCredits(): void;
  /** Parts can't be made on this site right now (a sticky refusal). */
  unavailableReason: string | null;
  /** The generate request is in flight. */
  generating: boolean;
  /** The last generate attempt's error, in plain words. */
  error: string | null;
  onGenerate(): void;
  /** Every take of the project (newest first from the server). */
  takes: RemixPartTake[];
  /** The current (edited) part lanes. */
  parts: RemixPart[];
  /** Takes a lane uses (edited or saved): not deletable. */
  inUseTakeIds: ReadonlySet<string>;
  /** Lane whose "Try other takes" opened the tray; null = none. */
  targetPartId: string | null;
  onClearTarget(): void;
  auditionTakeId: string | null;
  auditionLoadingTakeId: string | null;
  onAudition(take: RemixPartTake): void;
  onUseTake(take: RemixPartTake): void;
  onDeleteTake(take: RemixPartTake): void;
  /** Mini waveform of a decoded take; null while loading. */
  takePeaks(takeId: string): number[] | null;
};

const CHIP =
  "flex min-h-8 items-center justify-center rounded-md border px-2 py-1 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-purple-300";

/** "Add a part" section: the form, the money line and the takes tray. */
export function RemixPartsSection(props: { model: RemixPartsModel; locked: boolean }) {
  return <RemixPartsView idPrefix={useId()} {...props} />;
}

export function RemixPartsView({
  idPrefix,
  model,
  locked,
}: {
  idPrefix: string;
  model: RemixPartsModel;
  locked: boolean;
}) {
  const headingId = `${idPrefix}-parts`;
  const roleLabelId = `${idPrefix}-parts-role`;
  const barsLabelId = `${idPrefix}-parts-bars`;
  const barsReasonId = `${idPrefix}-parts-bars-reason`;
  const styleId = `${idPrefix}-parts-style`;
  const styleCountId = `${idPrefix}-parts-style-count`;
  const reasonId = `${idPrefix}-parts-reason`;
  const moneyId = `${idPrefix}-parts-money`;
  const tempoKnown = model.bpm !== null && model.bpm > 0;
  const eightBarsReason = partBarsReason(model.bpm, 8);
  const availability = describePartsGenerate({
    locked,
    unavailableReason: model.unavailableReason,
    bpm: model.bpm,
    bars: model.bars,
    generating: model.generating,
    batchActive: partTakesActive(model.takes),
    credits: model.credits,
  });
  const batches = partTakeBatches(model.takes, model.role);
  const targetPart =
    model.targetPartId !== null
      ? (model.parts.find((part) => part.id === model.targetPartId) ?? null)
      : null;
  const generateLabel = model.generating
    ? "Starting…"
    : `Generate ${PART_TAKES_PER_BATCH} takes`;
  const describedBy = [availability.reason ? reasonId : null, model.credits ? moneyId : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="remix-parts" role="group" aria-labelledby={headingId}>
      <div className="flex items-center gap-2">
        <h3 id={headingId} className="text-sm font-semibold text-zinc-100">
          Add a part
        </h3>
        <span className="rounded border border-sky-400/50 bg-sky-500/15 px-1.5 text-[10px] font-semibold tracking-wide text-sky-200 remix-parts-ai-badge">
          AI
        </span>
      </div>
      <p className="mt-1 text-xs text-zinc-400">{PARTS_INTRO}</p>

      {!tempoKnown ? (
        // Nothing to generate against: the honest note, no dead button.
        <p className="mt-3 text-xs text-zinc-400 remix-parts-needs-tempo">
          {PARTS_NEED_TEMPO_NOTE}
        </p>
      ) : (
        <>
          <div className="mt-3 space-y-3">
            <div>
              <div className="mb-1 text-xs text-zinc-500" id={roleLabelId}>
                Instrument
              </div>
              <div
                role="radiogroup"
                aria-labelledby={roleLabelId}
                className="grid grid-cols-3 gap-1.5 remix-parts-roles"
              >
                {REMIX_PART_ROLES.map((role) => {
                  const active = role === model.role;
                  return (
                    <label
                      key={role}
                      className={`${CHIP} remix-parts-role remix-parts-role-${role} ${
                        locked ? "cursor-not-allowed opacity-60" : "cursor-pointer"
                      } ${
                        active
                          ? "border-purple-500/60 bg-purple-500/15 text-purple-200"
                          : "border-zinc-700 bg-zinc-950 text-zinc-200 hover:border-zinc-500"
                      }`}
                    >
                      <input
                        type="radio"
                        name={`${idPrefix}-parts-role`}
                        value={role}
                        className="sr-only"
                        checked={active}
                        disabled={locked}
                        onChange={() => model.onRoleChange(role)}
                      />
                      {REMIX_PART_ROLE_LABELS[role]}
                    </label>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="mb-1 text-xs text-zinc-500" id={barsLabelId}>
                Length
              </div>
              <div
                role="radiogroup"
                aria-labelledby={barsLabelId}
                aria-describedby={eightBarsReason ? barsReasonId : undefined}
                className="grid grid-cols-2 overflow-hidden rounded-md border border-zinc-700 remix-parts-bars"
              >
                {PART_BARS_OPTIONS.map((bars) => {
                  const active = bars === model.bars;
                  const reason = partBarsReason(model.bpm, bars);
                  const disabled = locked || reason !== null;
                  return (
                    <label
                      key={bars}
                      title={reason ?? undefined}
                      className={`flex items-center justify-center px-2 py-1.5 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset has-[:focus-visible]:ring-purple-300 remix-parts-bars-${bars} ${
                        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
                      } ${
                        active
                          ? "bg-purple-500/25 text-purple-200"
                          : "bg-zinc-950 text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      <input
                        type="radio"
                        name={`${idPrefix}-parts-bars`}
                        value={bars}
                        className="sr-only"
                        checked={active}
                        disabled={disabled}
                        onChange={() => model.onBarsChange(bars)}
                      />
                      {bars} bars
                    </label>
                  );
                })}
              </div>
              {eightBarsReason && (
                <p id={barsReasonId} className="mt-1 text-[11px] text-zinc-500 remix-parts-bars-reason">
                  {eightBarsReason}
                </p>
              )}
            </div>

            <div>
              <div className="mb-1 flex items-baseline justify-between text-xs">
                <label htmlFor={styleId} className="text-zinc-500">
                  Style <span className="text-zinc-600">(optional)</span>
                </label>
                <span
                  id={styleCountId}
                  className="tabular-nums text-zinc-500 remix-parts-style-count"
                >
                  {model.style.length}/{PART_STYLE_MAX_CHARS}
                </span>
              </div>
              <input
                id={styleId}
                type="text"
                value={model.style}
                maxLength={PART_STYLE_MAX_CHARS}
                placeholder="e.g. warm, funky, 80s"
                disabled={locked}
                autoComplete="off"
                aria-describedby={styleCountId}
                className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-purple-500/60 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 remix-parts-style"
                onChange={(event) =>
                  model.onStyleChange(event.target.value.slice(0, PART_STYLE_MAX_CHARS))
                }
              />
            </div>
          </div>

        <div className="mt-3">
          {model.credits && (
            <p id={moneyId} className="mb-2 text-xs text-zinc-300 remix-parts-money">
              {partsMoneyLine({
                priceCentsPer30s: model.credits.priceCentsPer30s,
                balanceCents: model.credits.balanceCents,
              })}
            </p>
          )}
          <button
            type="button"
            className="ui-btn ui-btn-primary w-full remix-parts-generate"
            aria-disabled={!availability.enabled || undefined}
            aria-busy={model.generating || undefined}
            aria-describedby={describedBy || undefined}
            onClick={(event) => {
              if (!availability.enabled) {
                event.preventDefault();
                return;
              }
              model.onGenerate();
            }}
          >
            {generateLabel}
          </button>
          <div aria-live="polite" className="remix-parts-status">
            {availability.reason && (
              <p id={reasonId} className="mt-2 text-xs text-zinc-500 remix-parts-reason">
                {availability.reason}
              </p>
            )}
            {availability.needsCredits && (
              <div className="mt-1.5 flex items-center gap-2 text-xs">
                {model.creditRequest === "sent" ? (
                  <span className="text-zinc-400 remix-parts-credits-sent">
                    Request sent, credits are on their way.
                  </span>
                ) : (
                  <button
                    type="button"
                    className="ui-btn ui-btn-ghost ui-btn-sm remix-parts-request-credits"
                    disabled={model.creditRequest === "sending"}
                    onClick={model.onRequestCredits}
                  >
                    {model.creditRequest === "sending" ? "Sending…" : "Request credits"}
                  </button>
                )}
              </div>
            )}
            {model.error && (
              <p role="alert" className="mt-2 text-xs text-red-300 remix-parts-error">
                {model.error}
              </p>
            )}
          </div>
        </div>

        <PartTakesTray
          batches={batches}
          model={model}
          locked={locked}
          targetLaneName={targetPart ? partLaneName(targetPart.role) : null}
        />
        </>
      )}
    </div>
  );
}

/** The takes tray for the selected instrument, grouped by batch. */
function PartTakesTray({
  batches,
  model,
  locked,
  targetLaneName,
}: {
  batches: PartTakeBatch[];
  model: RemixPartsModel;
  locked: boolean;
  targetLaneName: string | null;
}) {
  const roleLabel = REMIX_PART_ROLE_LABELS[model.role];
  return (
    <div className="mt-4 border-t border-zinc-800 pt-3 remix-parts-tray">
      <div className="flex items-baseline justify-between gap-2">
        <h4
          id={PARTS_TRAY_ID}
          tabIndex={-1}
          className="text-xs font-semibold text-zinc-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-300"
        >
          {roleLabel} takes
        </h4>
        <span aria-live="polite" className="text-[11px] text-zinc-500 remix-parts-tray-status">
          {trayStatusText(batches)}
        </span>
      </div>
      {targetLaneName && (
        <p className="mt-1 flex items-center justify-between gap-2 text-[11px] text-purple-200 remix-parts-target">
          <span>Trying other takes for the {targetLaneName} lane.</span>
          <button
            type="button"
            className="shrink-0 rounded border border-zinc-700 px-1.5 py-0.5 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
            onClick={model.onClearTarget}
          >
            Done
          </button>
        </p>
      )}
      {batches.length === 0 ? (
        <p className="mt-2 text-xs text-zinc-500 remix-parts-tray-empty">
          No {roleLabel.toLowerCase()} takes yet. Generate {PART_TAKES_PER_BATCH} takes to hear
          some options.
        </p>
      ) : (
        <div className="mt-2 space-y-3">
          {batches.map((batch) => (
            <div key={batch.batchId} className="remix-parts-batch">
              <div className="mb-1 text-[11px] text-zinc-500">
                {batch.bars} bars{batch.style ? ` · “${batch.style}”` : ""}
              </div>
              <ul className="m-0 list-none space-y-1.5 p-0">
                {batch.takes.map(({ take, number }) => (
                  <PartTakeCard
                    key={take.id}
                    take={take}
                    number={number}
                    model={model}
                    locked={locked}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PartTakeCard({
  take,
  number,
  model,
  locked,
}: {
  take: RemixPartTake;
  number: number;
  model: RemixPartsModel;
  locked: boolean;
}) {
  const state = partTakeState(take.status);
  const name = `Take ${number}`;
  const auditioning = model.auditionTakeId === take.id;
  const loading = model.auditionLoadingTakeId === take.id;
  const target = partUseTarget(take, model.parts, model.targetPartId);
  const use = takeUseAction(target, locked);
  const remove = takeDeleteAvailability(take, model.inUseTakeIds, locked);
  const peaks = state === "ready" ? model.takePeaks(take.id) : null;
  const noteId = `remix-part-take-${take.id}-note`;
  return (
    <li
      className={`rounded-md border px-2 py-1.5 remix-parts-take remix-parts-take-${state} ${
        auditioning ? "border-purple-500/60 bg-purple-500/10" : "border-zinc-800 bg-zinc-950"
      }`}
      data-take-id={take.id}
    >
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-zinc-200">{name}</span>
        <span
          className={`text-[11px] remix-parts-take-status ${
            state === "failed"
              ? "text-amber-200"
              : state === "ready"
                ? "text-emerald-300"
                : "text-zinc-400"
          }`}
        >
          {takeStatusLabel(take)}
        </span>
        <span className="ml-auto rounded border border-sky-400/40 px-1 text-[9px] font-semibold text-sky-200">
          AI
        </span>
        <button
          type="button"
          aria-label={`Delete ${name}${remove.reason ? ` — ${remove.reason}` : ""}`}
          aria-disabled={!remove.enabled || undefined}
          title={remove.reason ?? `Delete ${name}`}
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-0 bg-transparent p-0 text-zinc-500 remix-parts-take-delete ${
            remove.enabled ? "hover:bg-red-500/15 hover:text-red-200" : "cursor-not-allowed opacity-40"
          }`}
          onClick={() => {
            if (remove.enabled) model.onDeleteTake(take);
          }}
        >
          <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3 w-3">
            <path
              d="M3 4.5h10M6.5 4.5V3h3v1.5M5 4.5l.6 8.5h4.8l.6-8.5"
              stroke="currentColor"
              strokeWidth="1.3"
              fill="none"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
      {state === "generating" && (
        <div
          aria-hidden="true"
          className="mt-1.5 h-1 overflow-hidden rounded-full bg-zinc-800 remix-parts-take-progress"
        >
          <div className="h-full w-1/3 animate-pulse rounded-full bg-purple-400/60" />
        </div>
      )}
      {state === "failed" && (
        <p className="mt-1 text-[11px] text-zinc-400 remix-parts-take-failure">
          {takeFailureDetail(take.errorCode)}
        </p>
      )}
      {state === "ready" && (
        <>
          <div className="mt-1.5 h-6 remix-parts-take-waveform">
            {peaks ? (
              <svg
                aria-hidden="true"
                className="h-full w-full"
                viewBox="0 0 200 24"
                preserveAspectRatio="none"
              >
                <path d={peaksToSvgPath(peaks, 200, 24)} className="fill-sky-200/70" />
              </svg>
            ) : (
              <div aria-hidden="true" className="mt-2.5 h-1 animate-pulse rounded-full bg-zinc-800" />
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              aria-pressed={auditioning}
              aria-busy={loading || undefined}
              title={
                auditioning
                  ? "Back to your arrangement"
                  : "Hear your arrangement with this take playing along"
              }
              className={`rounded-md border px-2 py-0.5 text-xs transition-colors remix-parts-take-audition ${
                auditioning
                  ? "border-purple-400/70 bg-purple-500/25 text-purple-100"
                  : "border-zinc-700 bg-zinc-900 text-zinc-200 hover:border-purple-500/60"
              }`}
              onClick={() => model.onAudition(take)}
            >
              {loading ? "Loading…" : auditioning ? "Stop audition" : "Audition"}
            </button>
            <button
              type="button"
              aria-disabled={!use.enabled || undefined}
              aria-describedby={use.note ? noteId : undefined}
              className={`rounded-md border px-2 py-0.5 text-xs transition-colors remix-parts-take-use ${
                use.enabled
                  ? "border-purple-400 bg-purple-600 text-white hover:bg-purple-500"
                  : "cursor-not-allowed border-zinc-700 bg-zinc-900 text-zinc-500"
              }`}
              onClick={() => {
                if (use.enabled) model.onUseTake(take);
              }}
            >
              {use.label}
            </button>
          </div>
          {use.note && (
            <p id={noteId} className="mt-1 text-[11px] text-zinc-500 remix-parts-take-note">
              {use.note}
            </p>
          )}
        </>
      )}
    </li>
  );
}
