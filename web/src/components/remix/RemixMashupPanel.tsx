"use client";

/**
 * Mashups (#2560, Remix Studio Pro S6f-3c of #1903). The owner adds a second
 * track B to the draft, picked from the tracks they can remix, then sets how
 * B is conformed to track A: the tempo ratio, a key shift, the bar of A where
 * B's first bar lands, and B's first downbeat when the measured one is off.
 * Track A always leads: its grid, sections and cues stay as they are.
 */
import { useEffect, useRef, useState } from "react";
import type {
  RemixMashupCandidate,
  RemixProjectSource,
} from "../../lib/api";
import {
  MASHUP_FIRST_BEAT_MAX_SEC,
  MASHUP_SEMITONES_MAX,
  MASHUP_SEMITONES_MIN,
  MASHUP_TEMPO_RATIO_MAX,
  MASHUP_TEMPO_RATIO_MIN,
  REMIX_MASHUP_SCHEMA_VERSION,
  keyLabel,
  suggestKeyShift,
  suggestTempoRatio,
  type MashupConformSkip,
  type MashupKey,
  type RemixMashup,
} from "../../lib/remixMashup";

const btn =
  "rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed";
const primaryBtn =
  "rounded-md border border-purple-400/60 bg-purple-600/70 px-3 py-1 text-xs font-semibold text-white hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed";
const input =
  "rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-100";

type Draft = {
  tempoRatio: string;
  semitones: number;
  offsetBars: string;
  firstBeatSec: string;
};

function draftFrom(mashup: RemixMashup | null): Draft {
  const secondary = mashup?.secondary;
  return {
    tempoRatio: String(secondary?.tempoRatio ?? 1),
    semitones: secondary?.semitones ?? 0,
    offsetBars: String(secondary?.offsetBars ?? 0),
    firstBeatSec:
      secondary?.firstBeatSec !== undefined ? String(secondary.firstBeatSec) : "",
  };
}

/** The recipe a draft describes, or null while a field is out of range. */
export function mashupFromDraft(draft: Draft): RemixMashup | null {
  const tempoRatio = Number(draft.tempoRatio);
  const offsetBars = Number(draft.offsetBars);
  if (
    !Number.isFinite(tempoRatio) ||
    tempoRatio < MASHUP_TEMPO_RATIO_MIN ||
    tempoRatio > MASHUP_TEMPO_RATIO_MAX
  ) {
    return null;
  }
  if (!Number.isInteger(offsetBars) || offsetBars < 0 || offsetBars > 2000) return null;
  const firstBeatText = draft.firstBeatSec.trim();
  let firstBeatSec: number | undefined;
  if (firstBeatText) {
    firstBeatSec = Number(firstBeatText);
    if (
      !Number.isFinite(firstBeatSec) ||
      firstBeatSec < 0 ||
      firstBeatSec > MASHUP_FIRST_BEAT_MAX_SEC
    ) {
      return null;
    }
  }
  return {
    schemaVersion: REMIX_MASHUP_SCHEMA_VERSION,
    secondary: {
      tempoRatio,
      semitones: draft.semitones,
      offsetBars,
      ...(firstBeatSec !== undefined ? { firstBeatSec } : {}),
    },
  };
}

function sameMashup(a: RemixMashup | null, b: RemixMashup | null): boolean {
  return JSON.stringify(a?.secondary ?? null) === JSON.stringify(b?.secondary ?? null);
}

function formatBpm(bpm: number | null): string | null {
  return bpm ? `${Math.round(bpm * 10) / 10} BPM` : null;
}

function signed(semitones: number): string {
  return semitones > 0 ? `+${semitones}` : String(semitones);
}

export const MASHUP_SKIP_TEXT: Record<MashupConformSkip, string> = {
  no_lead_grid:
    "Track A has no bar grid, so the second track plays as it is, without matching.",
  offset_past_end:
    "That bar is past the end of track A, so the second track plays as it is.",
};

/** Plain copy for what the user may do with a candidate track. */
export function candidateRightsText(candidate: Pick<RemixMashupCandidate, "allowedActions">): string {
  if (candidate.allowedActions.includes("export")) return "Draft, release and export";
  if (candidate.allowedActions.includes("publish_resonate")) {
    return "Draft and release on Resonate; export needs a commercial license";
  }
  return "Private draft only";
}

export function RemixMashupPanel({
  leadTitle,
  leadBpm,
  leadKey,
  secondary,
  secondaryBpm,
  secondaryKey,
  saved,
  skipped,
  secondaryExportBlocked,
  maxOffsetBars,
  disabled,
  disabledReason,
  saving,
  error,
  loadCandidates,
  onAttach,
  onRemove,
  onSave,
}: {
  leadTitle: string;
  leadBpm: number | null;
  leadKey: MashupKey | null;
  secondary: RemixProjectSource | null;
  secondaryBpm: number | null;
  secondaryKey: MashupKey | null;
  saved: RemixMashup | null;
  skipped: MashupConformSkip | null;
  /** B's rights stop the export (Remix tier on B). */
  secondaryExportBlocked: boolean;
  /** A's bar count, for the offset field; null when unknown. */
  maxOffsetBars: number | null;
  disabled?: boolean;
  disabledReason?: string | null;
  saving?: boolean;
  error?: string | null;
  loadCandidates(query: string): Promise<RemixMashupCandidate[]>;
  onAttach(candidate: RemixMashupCandidate): void;
  onRemove(): void;
  onSave(mashup: RemixMashup): void;
}) {
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<RemixMashupCandidate[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(saved));
  const [syncedFrom, setSyncedFrom] = useState(saved);
  if (syncedFrom !== saved) {
    setSyncedFrom(saved);
    setDraft(draftFrom(saved));
  }

  const requestRef = useRef(0);
  const loadRef = useRef(loadCandidates);
  useEffect(() => {
    loadRef.current = loadCandidates;
  });
  useEffect(() => {
    if (!picking) return;
    const request = ++requestRef.current;
    const timer = setTimeout(() => {
      loadRef
        .current(query)
        .then((items) => {
          if (requestRef.current !== request) return;
          setCandidates(items);
          setLoadError(null);
        })
        .catch(() => {
          if (requestRef.current !== request) return;
          setLoadError("Couldn't load tracks. Check your connection and try again.");
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [picking, query]);

  const locked = disabled || saving;

  if (!secondary) {
    return (
      <div
        className="mt-3 rounded-md border border-zinc-800 bg-zinc-950/60 p-3 text-xs text-zinc-300 remix-mashup-panel"
        role="group"
        aria-label="Mashup"
      >
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-semibold text-zinc-100">Mashup</span>
          <span className="text-zinc-500">
            Play stems of a second track over “{leadTitle}”, matched to its tempo and key.
          </span>
        </div>
        {!picking ? (
          <button
            type="button"
            className={`${btn} mt-2 remix-mashup-add`}
            disabled={locked}
            title={disabledReason ?? undefined}
            onClick={() => setPicking(true)}
          >
            Add a second track
          </button>
        ) : (
          <div className="mt-2">
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search tracks you can remix"
                aria-label="Search tracks you can remix"
                className={`${input} w-64 max-w-full`}
                autoFocus
              />
              <button type="button" className={btn} onClick={() => setPicking(false)}>
                Cancel
              </button>
            </div>
            {loadError ? (
              <p className="mt-2 text-red-300" role="alert">{loadError}</p>
            ) : candidates === null ? (
              <p className="mt-2 text-zinc-500" aria-live="polite">Loading tracks…</p>
            ) : candidates.length === 0 ? (
              <p className="mt-2 text-zinc-500" aria-live="polite">
                No track you can remix matches. Only tracks whose stems you hold a
                license for, and whose artist allows remixes, can be paired.
              </p>
            ) : (
              <ul className="mt-2 space-y-1 remix-mashup-candidates">
                {candidates.map((candidate) => {
                  const tempo = suggestTempoRatio(leadBpm, candidate.tempoBpm);
                  const facts = [
                    formatBpm(candidate.tempoBpm),
                    keyLabel(candidate.key),
                  ].filter(Boolean);
                  return (
                    <li
                      key={candidate.trackId}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-zinc-800 px-3 py-2"
                    >
                      <div className="min-w-[10rem] flex-1">
                        <div className="text-sm text-zinc-200">
                          {candidate.trackTitle}
                          {candidate.artistName ? (
                            <span className="text-zinc-500"> · {candidate.artistName}</span>
                          ) : null}
                        </div>
                        <div className="text-zinc-500">
                          {facts.length > 0 ? `${facts.join(" · ")} · ` : ""}
                          {candidateRightsText(candidate)}
                          {tempo && !tempo.inRange ? " · too far apart in tempo to match" : ""}
                        </div>
                      </div>
                      <button
                        type="button"
                        className={btn}
                        disabled={locked}
                        onClick={() => {
                          setPicking(false);
                          onAttach(candidate);
                        }}
                      >
                        Use this track
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
        {error ? <p className="mt-2 text-red-300" role="alert">{error}</p> : null}
      </div>
    );
  }

  const suggestion = suggestTempoRatio(leadBpm, secondaryBpm);
  const suggestedKey = suggestKeyShift(leadKey, secondaryKey);
  const next = mashupFromDraft(draft);
  const changed = next !== null && !sameMashup(next, saved);
  const ratio = Number(draft.tempoRatio);
  const conformedBpm =
    secondaryBpm && Number.isFinite(ratio) ? secondaryBpm * ratio : null;
  const offsetMax = Math.min(2000, Math.max(0, (maxOffsetBars ?? 2001) - 1));

  return (
    <div
      className="mt-3 rounded-md border border-zinc-800 bg-zinc-950/60 p-3 text-xs text-zinc-300 remix-mashup-panel"
      role="group"
      aria-label="Mashup"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-semibold text-zinc-100">Mashup</span>
        <span>
          Track A “{leadTitle}” leads · Track B “{secondary.trackTitle}”
          {secondary.artistName ? ` by ${secondary.artistName}` : ""}
        </span>
        <button
          type="button"
          className={`${btn} remix-mashup-remove`}
          disabled={locked}
          onClick={onRemove}
          title="Removes track B and its stems from this draft"
        >
          Remove track B
        </button>
      </div>
      {secondaryExportBlocked ? (
        <p className="mt-1 text-amber-200 remix-mashup-export-note">
          Track B needs a commercial license to export. You can still draft and
          release this mashup on Resonate.
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1">
          <span>Tempo ratio</span>
          <input
            type="number"
            inputMode="decimal"
            step={0.01}
            min={MASHUP_TEMPO_RATIO_MIN}
            max={MASHUP_TEMPO_RATIO_MAX}
            value={draft.tempoRatio}
            disabled={locked}
            onChange={(e) => setDraft({ ...draft, tempoRatio: e.target.value })}
            className={`${input} w-20`}
            aria-label="Tempo ratio of track B"
          />
        </label>
        <span className="text-zinc-500">
          {secondaryBpm && leadBpm
            ? `B ${formatBpm(secondaryBpm)} → ${formatBpm(conformedBpm)} (A is ${formatBpm(leadBpm)})`
            : "Track B has no measured tempo; set the ratio by ear."}
        </span>
        {suggestion?.inRange ? (
          <button
            type="button"
            className={btn}
            disabled={locked || Number(draft.tempoRatio) === suggestion.ratio}
            onClick={() => setDraft({ ...draft, tempoRatio: String(suggestion.ratio) })}
          >
            Match tempo ({suggestion.ratio}
            {suggestion.feel === "half" ? ", half time" : suggestion.feel === "double" ? ", double time" : ""})
          </button>
        ) : null}
      </div>
      {suggestion && !suggestion.inRange ? (
        <p className="mt-1 text-amber-200 remix-mashup-far-apart" role="status">
          These tracks are too far apart in tempo to match: track B can be sped
          up or slowed down by about a third at most ({MASHUP_TEMPO_RATIO_MIN}–
          {MASHUP_TEMPO_RATIO_MAX}), even at half or double time.
        </p>
      ) : null}
      {draft.tempoRatio.trim() !== "" && next === null && !Number.isNaN(ratio) &&
      (ratio < MASHUP_TEMPO_RATIO_MIN || ratio > MASHUP_TEMPO_RATIO_MAX) ? (
        <p className="mt-1 text-red-300">
          The ratio must be between {MASHUP_TEMPO_RATIO_MIN} and {MASHUP_TEMPO_RATIO_MAX}.
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1">
          <span>Key shift</span>
          <select
            value={draft.semitones}
            disabled={locked}
            onChange={(e) => setDraft({ ...draft, semitones: Number(e.target.value) })}
            className={input}
            aria-label="Key shift of track B in semitones"
          >
            {Array.from(
              { length: MASHUP_SEMITONES_MAX - MASHUP_SEMITONES_MIN + 1 },
              (_, i) => MASHUP_SEMITONES_MIN + i,
            ).map((value) => (
              <option key={value} value={value}>
                {value === 0 ? "0 (as it is)" : `${signed(value)} semitones`}
              </option>
            ))}
          </select>
        </label>
        <span className="text-zinc-500">
          {leadKey && secondaryKey
            ? `A is ${keyLabel(leadKey)}, B is ${keyLabel(secondaryKey)}`
            : "A key is not measured; shift by ear."}
        </span>
        {suggestedKey !== null ? (
          <button
            type="button"
            className={btn}
            disabled={locked || draft.semitones === suggestedKey}
            onClick={() => setDraft({ ...draft, semitones: suggestedKey })}
          >
            Suggested: {suggestedKey === 0 ? "no shift" : `${signed(suggestedKey)}`}
          </button>
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1">
          <span>B starts at bar</span>
          <input
            type="number"
            inputMode="numeric"
            step={1}
            min={0}
            max={offsetMax}
            value={draft.offsetBars}
            disabled={locked}
            onChange={(e) => setDraft({ ...draft, offsetBars: e.target.value })}
            className={`${input} w-20`}
            aria-label="Bar of track A where track B starts"
          />
        </label>
        <span className="text-zinc-500">
          of track A{maxOffsetBars ? ` (0–${offsetMax})` : ""}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1">
          <span>B’s first downbeat</span>
          <input
            type="number"
            inputMode="decimal"
            step={0.01}
            min={0}
            max={MASHUP_FIRST_BEAT_MAX_SEC}
            value={draft.firstBeatSec}
            placeholder="measured"
            disabled={locked}
            onChange={(e) => setDraft({ ...draft, firstBeatSec: e.target.value })}
            className={`${input} w-24`}
            aria-label="First downbeat of track B in seconds"
          />
          <span>s</span>
        </label>
        {draft.firstBeatSec.trim() ? (
          <button
            type="button"
            className={btn}
            disabled={locked}
            onClick={() => setDraft({ ...draft, firstBeatSec: "" })}
          >
            Use measured
          </button>
        ) : (
          <span className="text-zinc-500">Correct it when B’s bars land off A’s.</span>
        )}
      </div>

      {skipped ? (
        <p className="mt-2 text-amber-200" role="status">{MASHUP_SKIP_TEXT[skipped]}</p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={primaryBtn}
          disabled={locked || !changed}
          onClick={() => next && onSave(next)}
        >
          {saving ? "Applying…" : "Apply"}
        </button>
        {changed ? (
          <button type="button" className={btn} disabled={locked} onClick={() => setDraft(draftFrom(saved))}>
            Undo
          </button>
        ) : null}
        {disabledReason ? <span className="text-zinc-500">{disabledReason}</span> : null}
        {error ? <span className="text-red-300" role="alert">{error}</span> : null}
      </div>
    </div>
  );
}

