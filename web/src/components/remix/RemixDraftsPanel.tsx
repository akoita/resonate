"use client";

import type { MouseEvent, ReactNode } from "react";
import { formatDraftCost } from "../../lib/remixFormat";
import { provenanceChip } from "../../lib/remixIntent";
import { peaksToSvgPath } from "./RemixSessionLanes";

export type RemixDraftStatus = "queued" | "failed" | "completed" | "no_output";

export type RemixCurrentDraft = {
  status: RemixDraftStatus;
  failureMessage: string | null;
  /** "Stem mix render" | "AI draft" | a transform label. */
  kindLabel: string;
  /** Raw grounding value (e.g. "stem_audio"); rendered as a short chip. */
  provenance: string | null;
  /** Full honest grounding description (groundingDescription). */
  groundingDetail: string | null;
  transformNote: string | null;
  costUsd: number | null;
  completedAt: string | null;
  peaks: number[] | null;
  playing: boolean;
  loading: boolean;
};

export type RemixDraftVersion = {
  /** Playback key only — never rendered. */
  jobId: string;
  /** What the version is ("Stem mix render", "AI layer added", …). */
  label: string;
  provenance: string | null;
  costUsd: number | null;
  completedAt: string | null;
  peaks: number[] | null;
  playing: boolean;
  loading: boolean;
};

export type RemixDraftPublishAction = {
  enabled: boolean;
  reason: string | null;
  busy: boolean;
  /** Stable analytics code for the current availability. */
  reasonCode: string;
  onClick(): void;
  /** Called instead of onClick while unavailable (demand-signal analytics). */
  onLockedClick(): void;
};

export type RemixDraftExportAction = {
  enabled: boolean;
  reason: string | null;
  busy: boolean;
  onClick(): void;
  /** Called instead of onClick while locked (demand-signal analytics). */
  onLockedClick(): void;
};

export type RemixDraftsPanelProps = {
  current: RemixCurrentDraft | null;
  versions: RemixDraftVersion[];
  onPlayCurrent(): void;
  onPlayVersion(jobId: string): void;
  publish: RemixDraftPublishAction;
  exportAction: RemixDraftExportAction;
  /** Published remixes hide publish/export (the editor banner covers it). */
  published: boolean;
  /** Shown when there is no draft yet. */
  emptyHint: string;
  /** Clock for relative times; defaults to Date.now(). */
  now?: number;
};

/**
 * Completion time: relative within the last day ("just now", "5 min ago",
 * "3 h ago"), absolute ("Sep 24, 10:15 AM") beyond that. Null when unknown.
 */
export function formatCompletedAt(
  iso: string | null | undefined,
  now: number = Date.now(),
): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  const time = at.getTime();
  if (!Number.isFinite(time)) return null;
  const elapsedSec = (now - time) / 1000;
  if (elapsedSec < 60) return "just now";
  if (elapsedSec < 3600) return `${Math.floor(elapsedSec / 60)} min ago`;
  if (elapsedSec < 86400) return `${Math.floor(elapsedSec / 3600)} h ago`;
  return at.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Click handler for an action that stays focusable and explained while
 * unavailable: an unavailable click records the demand signal and never runs
 * the action.
 */
export function gatedClickHandler(action: {
  enabled: boolean;
  onClick(): void;
  onLockedClick(): void;
}): (event: Pick<MouseEvent, "preventDefault">) => void {
  return (event) => {
    if (!action.enabled) {
      event.preventDefault();
      action.onLockedClick();
      return;
    }
    action.onClick();
  };
}

function playLabel(state: { playing: boolean; loading: boolean }): string {
  if (state.loading) return "Loading…";
  return state.playing ? "Stop" : "Play";
}

function ProvenanceChip({ grounding }: { grounding: string | null }) {
  const chip = provenanceChip(grounding);
  if (!chip) return null;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium remix-provenance-chip remix-provenance-chip--${chip.tone} ${
        chip.tone === "stems"
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
          : "border-purple-500/40 bg-purple-500/10 text-purple-200"
      }`}
    >
      {chip.label}
    </span>
  );
}

function MiniWaveform({ peaks, className }: { peaks: number[] | null; className: string }) {
  if (!peaks || peaks.length === 0) return null;
  const path = peaksToSvgPath(peaks, 200, 32);
  if (!path) return null;
  return (
    <svg
      viewBox="0 0 200 32"
      preserveAspectRatio="none"
      aria-hidden="true"
      className={`block w-full ${className}`}
    >
      <path d={path} className="fill-purple-300/60" />
    </svg>
  );
}

function CurrentDraftCard({
  draft,
  onPlay,
  now,
  footer,
}: {
  draft: RemixCurrentDraft;
  onPlay(): void;
  now: number | undefined;
  /** Publish/Export row, rendered as the card footer. */
  footer: ReactNode;
}) {
  const settled = draft.status === "completed" || draft.status === "no_output";
  const cost = settled ? formatDraftCost(draft.costUsd) : null;
  const when = settled ? formatCompletedAt(draft.completedAt, now) : null;
  return (
    <div
      className={`rounded-md border border-zinc-800 bg-zinc-950 p-4 remix-current-draft remix-current-draft--${draft.status}`}
    >
      {/* Details on the left, playback on the right (sm+); stacked below. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-zinc-100">{draft.kindLabel}</div>
          {settled && (draft.provenance || cost || when) && (
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
              <ProvenanceChip grounding={draft.provenance} />
              {cost && <span className="remix-draft-cost">{cost}</span>}
              {when && <span className="remix-draft-time">{when}</span>}
            </div>
          )}

          {draft.status === "queued" && (
            <p role="status" className="mt-2 text-sm text-zinc-300 remix-draft-queued">
              <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-purple-400 align-middle" />
              In progress — your draft appears here when it&apos;s ready.
            </p>
          )}
          {draft.status === "failed" && (
            <div className="mt-2 text-sm remix-draft-failed">
              <p className="text-red-300">
                {draft.failureMessage ?? "Generation failed. Please try again later."}
              </p>
              <p className="mt-1 text-xs text-zinc-500">Retry from the Create panel.</p>
            </div>
          )}
          {draft.status === "no_output" && (
            <p className="mt-2 text-xs text-zinc-500 remix-draft-no-output">
              This draft has no playable output yet.
            </p>
          )}

          {settled && draft.transformNote && (
            <p className="mt-2 text-xs text-zinc-400 remix-generation-transform">
              {draft.transformNote}
            </p>
          )}
          {settled && draft.groundingDetail && (
            <details className="mt-2 text-xs remix-generation-grounding">
              <summary className="cursor-pointer text-zinc-500 hover:text-zinc-300">
                How this draft was made
              </summary>
              <p className="mt-1 text-zinc-400">{draft.groundingDetail}</p>
            </details>
          )}
        </div>
        {draft.status === "completed" && (
          <button
            type="button"
            className="ui-btn ui-btn-ghost shrink-0 self-start remix-draft-playback-btn"
            aria-label={draft.playing ? "Stop draft" : "Play draft"}
            aria-busy={draft.loading || undefined}
            onClick={onPlay}
          >
            {playLabel(draft)}
          </button>
        )}
      </div>

      {draft.status === "completed" && (
        <MiniWaveform peaks={draft.peaks} className="mt-3 h-10 remix-draft-waveform" />
      )}

      {footer}
    </div>
  );
}

export function RemixDraftsPanel(props: RemixDraftsPanelProps) {
  const {
    current,
    versions,
    onPlayCurrent,
    onPlayVersion,
    publish,
    exportAction,
    published,
    emptyHint,
    now,
  } = props;

  return (
    <section
      className="bg-zinc-900 border border-zinc-800 rounded-lg p-5 remix-drafts-panel"
      aria-label="Drafts"
    >
      <h2 className="text-lg font-semibold text-white mb-3">Drafts</h2>

      {current ? (
        <CurrentDraftCard
          draft={current}
          onPlay={onPlayCurrent}
          now={now}
          footer={
            // Publish/Export belong to a draft: with none yet, the empty hint
            // already says what to do, so no locked buttons compete with it.
            !published && (
              <div className="mt-4 border-t border-zinc-800 pt-3 remix-draft-actions">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="ui-btn ui-btn-primary ui-btn-sm remix-action-publish"
                    aria-disabled={!publish.enabled || undefined}
                    aria-busy={publish.busy || undefined}
                    data-reason-code={publish.enabled ? undefined : publish.reasonCode}
                    onClick={gatedClickHandler(publish)}
                  >
                    {publish.busy ? "Publishing..." : "Publish on Resonate"}
                  </button>
                  {exportAction.enabled ? (
                    <button
                      type="button"
                      className="ui-btn ui-btn-ghost ui-btn-sm remix-action-export"
                      aria-busy={exportAction.busy || undefined}
                      onClick={gatedClickHandler(exportAction)}
                    >
                      {exportAction.busy ? "Exporting..." : "Export audio"}
                    </button>
                  ) : (
                    // Honest locked state (#1323): the click records the demand
                    // signal but never attempts the download.
                    <button
                      type="button"
                      aria-disabled="true"
                      aria-busy={exportAction.busy || undefined}
                      title={exportAction.reason ?? undefined}
                      className="ui-btn ui-btn-ghost ui-btn-sm opacity-60 cursor-not-allowed remix-action-unavailable remix-action-unavailable--export"
                      onClick={gatedClickHandler(exportAction)}
                    >
                      {exportAction.busy ? "Exporting..." : "Export audio"}
                      {exportAction.reason && (
                        <span className="sr-only"> — {exportAction.reason}</span>
                      )}
                    </button>
                  )}
                </div>
                {!publish.enabled && publish.reason && (
                  <p className="mt-2 text-xs text-zinc-500 remix-publish-reason">
                    {publish.reason}
                  </p>
                )}
              </div>
            )
          }
        />
      ) : (
        <p className="rounded-md border border-dashed border-zinc-700 p-4 text-sm text-zinc-500 remix-draft-empty">
          {emptyHint}
        </p>
      )}

      {versions.length > 0 && (
        <div className="mt-5 remix-draft-versions">
          <div className="text-xs text-zinc-500 mb-2">Previous versions</div>
          <ul className="space-y-1.5">
            {versions.map((version) => {
              const cost = formatDraftCost(version.costUsd);
              const when = formatCompletedAt(version.completedAt, now);
              return (
                <li
                  key={version.jobId}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 remix-draft-version"
                >
                  <span className="min-w-0 max-w-[14rem] truncate text-xs text-zinc-300">
                    {version.label}
                  </span>
                  {(version.provenance || cost || when) && (
                    <span className="flex shrink-0 flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                      <ProvenanceChip grounding={version.provenance} />
                      {cost && <span>{cost}</span>}
                      {when && <span>{when}</span>}
                    </span>
                  )}
                  <div className="min-w-16 flex-1">
                    <MiniWaveform
                      peaks={version.peaks}
                      className="h-6 remix-draft-version-waveform"
                    />
                  </div>
                  <button
                    type="button"
                    className="ui-btn ui-btn-ghost ui-btn-sm shrink-0 remix-draft-version-btn"
                    aria-label={`${version.playing ? "Stop" : "Play"} ${version.label}`}
                    aria-busy={version.loading || undefined}
                    onClick={() => onPlayVersion(version.jobId)}
                  >
                    {playLabel(version)}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
