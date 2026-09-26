"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getRemixDraftAudioBlob, getStemPreviewUrl } from "../../lib/api";
import { useOptionalPlayer } from "../../lib/playerContext";
import {
  clampOutputVolume,
  createStemPreviewEngine,
  loopEntryOffset,
  type PreviewBeat,
  type PreviewStemState,
  type StemArrangementPreviewHandle,
  type StemPreviewEngine,
} from "../../lib/remixAudioPreview";
import { beatRenderKey } from "../../lib/remixBeat";
import type { RemixFxRecipe } from "../../lib/remixFx";
import {
  isIdentityTimeline,
  type RemixStructureSegment,
  type RemixStructureTimeline,
} from "../../lib/remixStructure";
import { computePeaks, type PeakSourceBuffer } from "../../lib/remixWaveform";

/**
 * Remix Studio transport (#1879): the single owner of studio playback — the
 * stem arrangement preview (WebAudio), the untouched original (the full-mix
 * reference stem through the same engine), and generated drafts (an
 * HTMLAudioElement) — behind one play/stop/seek/loop surface with a shared
 * playhead. Also owns waveform peaks (decoded while preloading) and the
 * one-audio-source-at-a-time handshake with the site-wide player.
 */

export type TransportSource =
  | { kind: "arrangement" }
  | { kind: "original" }
  | { kind: "draft"; jobId: string | null };
export type TransportStatus = "idle" | "loading" | "playing";
export type TransportLoop = {
  sectionIndex: number;
  startSec: number;
  endSec: number;
};

export type RemixTransportInput = {
  token: string | null;
  projectId: string;
  /** All project stems, preloaded for waveforms and instant play. */
  stemIds: string[];
  /** Live `stemPreviewStates(project, edits)`. */
  previewStems: PreviewStemState[];
  soloStemId: string | null;
  referenceStemId: string | null;
  /** The project's generation job id when a playable draft exists, else null. */
  currentDraftJobId: string | null;
  /** Section-grid duration, the timeline length before buffers decode. */
  timelineSec: number | null;
  /** Effects recipe (#1897) the arrangement preview applies live. */
  effects?: RemixFxRecipe | null;
  /** Bar-grid tempo (bars grids only) for tempo-synced echo. */
  bpm?: number | null;
  /**
   * Structure timeline (#1899). When it is not the identity, the engine
   * sources (arrangement and original) play it: `durationSec`, seek, loop
   * and the playhead are in TIMELINE time, and `previewStems`'
   * `activeIntervals` must be timeline-time gate spans
   * (`gateIntervalsForBlocks`). A loop's `sectionIndex` is then a block
   * index. Drafts are rendered audio and ignore it.
   */
  timeline?: RemixStructureTimeline | null;
  /**
   * Beat (#1902), rendered over the current timeline's blocks (timeline
   * time; identity segments without a structure). Level and mute apply
   * live; a change to what it sounds like restarts at the same position.
   */
  beat?: PreviewBeat | null;
  /**
   * Listening volume (#1910): linear gain 0..1 for this device only — the
   * engine's final output stage and the draft element's `volume`. Applied
   * live, never restarting playback; absent = unity.
   */
  outputGain?: number;
  onError: (kind: "preview" | "draft") => void;
};

export type RemixTransport = {
  status: TransportStatus;
  source: TransportSource;
  loop: TransportLoop | null;
  /** The running engine handle, for the level meter; null otherwise. */
  previewHandle: StemArrangementPreviewHandle | null;
  /** Waveform peaks per stem id, filled in as stems decode. */
  peaks: Record<string, number[]>;
  /**
   * Beat waveform (#1902) across the timeline (the ring-out after the last
   * block is left out); null without a beat or while building.
   */
  beatPeaks: number[] | null;
  /**
   * Waveform peaks for a draft (#1879): null jobId = the current draft
   * (loaded eagerly); archived versions fill in once first played. Null
   * while unknown or when decoding failed.
   */
  draftPeaksFor: (jobId: string | null) => number[] | null;
  durationSec: number | null;
  /**
   * Current playhead in seconds; the idle cursor when stopped. Cheap: meant
   * to be polled per animation frame (the hook never re-renders per frame).
   */
  getPositionSec: () => number | null;
  play: () => Promise<void>;
  stop: () => void;
  toggle: () => void;
  seek: (sec: number) => void;
  setSource: (source: TransportSource) => void;
  setLoop: (loop: TransportLoop | null) => void;
};

/**
 * Object-URL cache key for a draft source: archived versions by job id, the
 * current draft by the project's current job id (so a new generation never
 * replays the previous draft's audio). Null = nothing playable.
 */
export function resolveDraftCacheKey(
  jobId: string | null,
  currentDraftJobId: string | null,
): string | null {
  if (jobId) return `job:${jobId}`;
  if (currentDraftJobId) return `current:${currentDraftJobId}`;
  return null;
}

/** Keep a seek target on the timeline; unknown duration only floors at 0. */
export function clampSeek(sec: number, durationSec: number | null): number {
  if (!Number.isFinite(sec) || sec <= 0) return 0;
  if (durationSec !== null && Number.isFinite(durationSec) && durationSec >= 0) {
    return Math.min(sec, durationSec);
  }
  return sec;
}

/**
 * Draft loop check (#1879): the element plays linearly, so once it reaches
 * the loop end it is sent back to the loop start. Null = keep playing.
 */
export function draftLoopSeekTarget(
  currentSec: number,
  loop: Pick<TransportLoop, "startSec" | "endSec"> | null,
): number | null {
  if (!loop || loop.endSec <= loop.startSec) return null;
  return currentSec >= loop.endSec ? loop.startSec : null;
}

/**
 * Transport length for a source: drafts use their own audio's duration;
 * engine sources use the structure timeline's (#1899) when one plays.
 */
export function transportDurationSec(input: {
  source: TransportSource;
  bufferDurationSec: number | null;
  timelineSec: number | null;
  draftDurationSec: number | null;
  structureSec?: number | null;
}): number | null {
  if (input.source.kind === "draft") return input.draftDurationSec;
  if (input.structureSec !== undefined && input.structureSec !== null) {
    return input.structureSec;
  }
  return input.bufferDurationSec ?? input.timelineSec;
}

/** The timeline the engine should play: null for none or the identity. */
export function structureTimelineFor(
  timeline: RemixStructureTimeline | null | undefined,
): RemixStructureTimeline | null {
  return timeline && !isIdentityTimeline(timeline) ? timeline : null;
}

/** Signature of a timeline, so a refetched but equal one restarts nothing. */
export function structureTimelineKey(
  timeline: RemixStructureTimeline | null,
): string {
  if (!timeline) return "";
  return JSON.stringify([
    timeline.durationSec,
    timeline.segments.map((segment) => [
      segment.section,
      segment.outStartSec,
      segment.outEndSec,
      segment.srcStartSec,
      segment.srcEndSec,
      segment.joinFadeIn,
      segment.joinFadeOut,
      segment.fadeIn,
      segment.fadeOut,
    ]),
  ]);
}

/**
 * A block loop after the timeline changed (#1899): the same block index,
 * re-read from the new segments (identity segments are the source spans);
 * null when that block no longer exists or no timeline is known.
 */
export function loopForTimeline(
  loop: TransportLoop | null,
  segments: RemixStructureSegment[] | null | undefined,
): TransportLoop | null {
  if (!loop) return null;
  const segment = segments?.[loop.sectionIndex];
  return segment
    ? {
        sectionIndex: loop.sectionIndex,
        startSec: segment.outStartSec,
        endSec: segment.outEndSec,
      }
    : null;
}

/**
 * Signature of what the beat sounds like (#1902): "" without one. Level and
 * mute are left out — they apply live.
 */
export function previewBeatKey(beat: PreviewBeat | null | undefined): string {
  return beat ? beatRenderKey(beat.recipe, beat.grid, beat.segments) : "";
}

/** Quiet time after the last beat edit before its waveform is rebuilt. */
export const BEAT_PEAKS_DEBOUNCE_MS = 150;

/**
 * Debounced beat waveform (#1902): after `delayMs` with no newer call (the
 * returned cancel runs on every beat edit), build the beat buffer and hand
 * back its peaks over the timeline (the ring-out padding after the last
 * block is left out). A step toggle burst renders once. Returns the cancel.
 */
export function scheduleBeatPeaks(input: {
  beat: PreviewBeat;
  key: string;
  build: (beat: PreviewBeat) => PeakSourceBuffer & { sampleRate: number } | null;
  onPeaks: (key: string, peaks: number[]) => void;
  delayMs?: number;
}): () => void {
  const timer = setTimeout(() => {
    const buffer = input.build(input.beat);
    if (!buffer) return;
    const segments = input.beat.segments;
    const timelineSec =
      segments.length > 0 ? segments[segments.length - 1].outEndSec : 0;
    const length = Math.min(
      buffer.length,
      Math.max(1, Math.ceil(timelineSec * buffer.sampleRate)),
    );
    input.onPeaks(
      input.key,
      computePeaks({
        numberOfChannels: 1,
        length,
        getChannelData: () => buffer.getChannelData(0),
      }),
    );
  }, input.delayMs ?? BEAT_PEAKS_DEBOUNCE_MS);
  return () => clearTimeout(timer);
}

/**
 * Signature of the section spans only, so live envelope re-scheduling runs
 * when cells change rather than on every editor render.
 */
export function previewSectionsKey(stems: PreviewStemState[]): string {
  return JSON.stringify(
    stems.map((stem) => [
      stem.stemId,
      stem.activeIntervals === undefined || stem.activeIntervals === null
        ? null
        : stem.activeIntervals.map((span) => [span.startSec, span.endSec]),
    ]),
  );
}

/**
 * Stems as the engine should hear them for a source (#1879): on "original"
 * the reference stem plays whole, never section-gated, even when a legacy
 * project still has it unmuted as a gated channel — the comparison is always
 * against the untouched original.
 */
export function enginePreviewStems(
  stems: PreviewStemState[],
  source: TransportSource,
  referenceStemId: string | null,
): PreviewStemState[] {
  if (source.kind !== "original" || !referenceStemId) return stems;
  return stems.map((stem) =>
    stem.stemId === referenceStemId
      ? { ...stem, activeIntervals: undefined }
      : stem,
  );
}

/**
 * Effects the engine should apply for a source (#1897): "original" is the
 * untouched A/B reference, so it plays without effects.
 */
export function engineEffects(
  effects: RemixFxRecipe | null | undefined,
  source: TransportSource,
): RemixFxRecipe | null {
  return source.kind === "original" ? null : effects ?? null;
}

/**
 * Drop entries keyed to a current draft that is no longer current (#1879):
 * a new generation must not show the previous draft's waveform. Returns the
 * same object when nothing changes, so it is safe inside setState.
 */
export function dropStaleCurrentDraftKeys<T>(
  record: Record<string, T>,
  currentDraftJobId: string | null,
): Record<string, T> {
  const keep = resolveDraftCacheKey(null, currentDraftJobId);
  const stale = Object.keys(record).filter(
    (key) => key.startsWith("current:") && key !== keep,
  );
  if (stale.length === 0) return record;
  const next = { ...record };
  for (const key of stale) delete next[key];
  return next;
}

function sameSource(a: TransportSource, b: TransportSource): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "draft" && b.kind === "draft") return a.jobId === b.jobId;
  return true;
}

const isEngineSource = (source: TransportSource) => source.kind !== "draft";

type Playing =
  | { mode: "engine"; handle: StemArrangementPreviewHandle }
  | { mode: "draft"; audio: HTMLAudioElement; key: string }
  | null;

/**
 * Applies the listening volume (#1910) live: to the engine's output stage
 * (running or not, so the next play starts at it) and to a playing draft
 * element. Non-finite gains play at unity; the result is clamped to 0..1.
 */
export function applyListeningGain(
  targets: {
    engine: Pick<StemPreviewEngine, "setOutputVolume"> | null;
    playing:
      | { mode: "engine" }
      | { mode: "draft"; audio: Pick<HTMLAudioElement, "volume"> }
      | null;
  },
  gain: number,
): void {
  const volume = clampOutputVolume(gain);
  targets.engine?.setOutputVolume(volume);
  if (targets.playing?.mode === "draft") targets.playing.audio.volume = volume;
}

export function useRemixTransport(input: RemixTransportInput): RemixTransport {
  const [status, setStatus] = useState<TransportStatus>("idle");
  const [source, setSourceState] = useState<TransportSource>({
    kind: "arrangement",
  });
  const [loop, setLoopState] = useState<TransportLoop | null>(null);
  const [previewHandle, setPreviewHandle] =
    useState<StemArrangementPreviewHandle | null>(null);
  const [peaks, setPeaks] = useState<Record<string, number[]>>({});
  const [beatPeaksState, setBeatPeaksState] = useState<{
    key: string;
    peaks: number[];
  } | null>(null);
  const [bufferDurationSec, setBufferDurationSec] = useState<number | null>(
    null,
  );
  const [draftDurations, setDraftDurations] = useState<Record<string, number>>(
    {},
  );
  // Draft waveforms by draft cache key (#1879).
  const [draftPeaks, setDraftPeaks] = useState<Record<string, number[]>>({});
  // Bumped when the idle cursor moves (seek/stop/end) so consumers re-render
  // and re-read getPositionSec; never bumped per frame.
  const [cursorRevision, setCursorRevision] = useState(0);

  // Latest inputs for callbacks that must stay stable across renders.
  const inputRef = useRef(input);
  inputRef.current = input;
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const loopRef = useRef(loop);
  loopRef.current = loop;
  const statusRef = useRef(status);
  statusRef.current = status;
  const outputGain = input.outputGain ?? 1;
  const outputGainRef = useRef(outputGain);
  outputGainRef.current = outputGain;

  const engineRef = useRef<StemPreviewEngine | null>(null);
  const playingRef = useRef<Playing>(null);
  // Bumped on every start/stop so audio that finishes loading after the user
  // (or the site player) stopped or restarted it never starts playing.
  const requestRef = useRef(0);
  const cursorRef = useRef(0);
  const draftUrlsRef = useRef(new Map<string, string>());
  // Current-draft URLs dropped while their element was still playing:
  // revoked on unmount instead of under the playing element.
  const retiredUrlsRef = useRef<string[]>([]);
  const draftFrameRef = useRef<number | null>(null);
  const peaksDoneRef = useRef(new Set<string>());
  // Draft blobs behind the cached object URLs (same lifetime), so waveforms
  // decode without a second download; in-flight downloads are shared.
  const draftBlobsRef = useRef(new Map<string, Blob>());
  const draftDownloadsRef = useRef(new Map<string, Promise<string | null>>());
  const draftPeaksDoneRef = useRef(new Set<string>());
  const unmountedRef = useRef(false);

  // Only one audio source at a time: studio audio pauses the site-wide
  // player, and the player starting stops studio audio. Null outside a
  // PlayerProvider (tests).
  const player = useOptionalPlayer();
  const playerRef = useRef(player);
  playerRef.current = player;
  const playerIsPlaying = player?.isPlaying ?? false;
  const playerWasPlayingRef = useRef(playerIsPlaying);

  const sourceDraftKey =
    source.kind === "draft"
      ? resolveDraftCacheKey(source.jobId, input.currentDraftJobId)
      : null;
  const structure = structureTimelineFor(input.timeline);
  const durationSec = transportDurationSec({
    source,
    bufferDurationSec,
    timelineSec: input.timelineSec,
    draftDurationSec: sourceDraftKey
      ? draftDurations[sourceDraftKey] ?? null
      : null,
    structureSec: structure?.durationSec ?? null,
  });
  const durationRef = useRef(durationSec);
  durationRef.current = durationSec;

  const engine = useCallback((): StemPreviewEngine => {
    if (!engineRef.current) {
      engineRef.current = createStemPreviewEngine({
        urlForStem: getStemPreviewUrl,
      });
      engineRef.current.setOutputVolume(outputGainRef.current);
    }
    return engineRef.current;
  }, []);

  /**
   * The draft's object URL, downloading it once (concurrent callers share
   * the request). Null when the draft stopped being the one `key` names
   * (a new generation landed mid-download) or the hook unmounted.
   */
  const fetchDraftUrl = useCallback(
    (key: string, jobId: string | null): Promise<string | null> => {
      const cached = draftUrlsRef.current.get(key);
      if (cached) return Promise.resolve(cached);
      const inFlight = draftDownloadsRef.current.get(key);
      if (inFlight) return inFlight;
      const { token, projectId } = inputRef.current;
      if (!token) return Promise.resolve(null);
      const download = (async () => {
        const blob = await getRemixDraftAudioBlob(
          token,
          projectId,
          jobId ?? undefined,
        );
        if (unmountedRef.current) return null;
        if (
          resolveDraftCacheKey(jobId, inputRef.current.currentDraftJobId) !== key
        ) {
          return null;
        }
        if (!draftUrlsRef.current.has(key)) {
          draftUrlsRef.current.set(key, URL.createObjectURL(blob));
          draftBlobsRef.current.set(key, blob);
        }
        return draftUrlsRef.current.get(key) ?? null;
      })();
      draftDownloadsRef.current.set(key, download);
      const settle = () => {
        if (draftDownloadsRef.current.get(key) === download) {
          draftDownloadsRef.current.delete(key);
        }
      };
      download.then(settle, settle);
      return download;
    },
    [],
  );

  /** Decode a downloaded draft once for its waveform; failures stay silent. */
  const ensureDraftPeaks = useCallback(
    (key: string) => {
      const blob = draftBlobsRef.current.get(key);
      if (!blob || draftPeaksDoneRef.current.has(key)) return;
      draftPeaksDoneRef.current.add(key);
      void (async () => {
        try {
          const data = await blob.arrayBuffer();
          if (unmountedRef.current) return;
          const buffer = await engine().decode(data);
          // Unmounted, or the draft was replaced while decoding.
          if (unmountedRef.current || draftBlobsRef.current.get(key) !== blob) {
            return;
          }
          const peaks = computePeaks(buffer);
          setDraftPeaks((known) => ({ ...known, [key]: peaks }));
        } catch {
          // No waveform for this draft; playback is unaffected.
        }
      })();
    },
    [engine],
  );

  const currentPosition = useCallback((): number => {
    const playing = playingRef.current;
    if (playing?.mode === "engine") return playing.handle.position();
    if (playing?.mode === "draft") return playing.audio.currentTime;
    return cursorRef.current;
  }, []);

  const cancelDraftFrame = () => {
    if (draftFrameRef.current !== null) {
      cancelAnimationFrame(draftFrameRef.current);
      draftFrameRef.current = null;
    }
  };

  /** Stop whatever plays (or loads) and invalidate pending starts. */
  const halt = useCallback((cursorSec: number | null) => {
    requestRef.current += 1;
    const playing = playingRef.current;
    const position = cursorSec ?? currentPosition();
    playingRef.current = null;
    if (playing?.mode === "engine") playing.handle.stop();
    if (playing?.mode === "draft") {
      playing.audio.onended = null;
      playing.audio.onerror = null;
      playing.audio.ontimeupdate = null;
      playing.audio.pause();
    }
    cancelDraftFrame();
    cursorRef.current = position;
  }, [currentPosition]);

  // The ref moves with the state so a second click (or the site player)
  // before the next render sees the new status.
  const updateStatus = useCallback((next: TransportStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const settleIdle = useCallback(() => {
    setPreviewHandle(null);
    updateStatus("idle");
    setCursorRevision((revision) => revision + 1);
  }, [updateStatus]);

  const pauseGlobalPlayer = () => {
    const current = playerRef.current;
    if (current?.isPlaying) current.togglePlay();
  };

  const startEngine = async (
    requestId: number,
    next: TransportSource,
    offsetSec: number,
    activeLoop: TransportLoop | null,
  ) => {
    const latest = inputRef.current;
    try {
      const handle = await engine().play({
        stems: enginePreviewStems(
          latest.previewStems,
          next,
          latest.referenceStemId,
        ),
        soloStemId: latest.soloStemId,
        referenceStemId:
          next.kind === "original" ? latest.referenceStemId : null,
        offsetSec,
        loop: activeLoop
          ? { startSec: activeLoop.startSec, endSec: activeLoop.endSec }
          : null,
        effects: engineEffects(latest.effects, next),
        bpm: latest.bpm ?? null,
        timeline: structureTimelineFor(latest.timeline),
        beat: latest.beat ?? null,
        onEnded: () => {
          if (requestId !== requestRef.current) return;
          halt(0);
          settleIdle();
        },
      });
      if (requestId !== requestRef.current) {
        // Stopped (or restarted) while the stems were loading.
        handle.stop();
        return;
      }
      playingRef.current = { mode: "engine", handle };
      setPreviewHandle(handle);
      updateStatus("playing");
    } catch {
      if (requestId !== requestRef.current) return;
      halt(offsetSec);
      settleIdle();
      inputRef.current.onError("preview");
    }
  };

  const startDraft = async (
    requestId: number,
    next: Extract<TransportSource, { kind: "draft" }>,
    offsetSec: number,
  ) => {
    const latest = inputRef.current;
    const key = resolveDraftCacheKey(next.jobId, latest.currentDraftJobId);
    if (!latest.token || !key) {
      halt(offsetSec);
      settleIdle();
      return;
    }
    try {
      let url = draftUrlsRef.current.get(key);
      if (!url) {
        // Shared with the eager current-draft download; a still-valid
        // download is cached even if the user moved on meanwhile.
        const fetched = await fetchDraftUrl(key, next.jobId);
        // Stopped or switched while downloading.
        if (requestId !== requestRef.current) return;
        if (!fetched) {
          // A new generation replaced this draft mid-download.
          halt(offsetSec);
          settleIdle();
          return;
        }
        url = fetched;
      }
      // Archived versions get their waveform from this first play.
      ensureDraftPeaks(key);
      const audio = new Audio(url);
      audio.volume = clampOutputVolume(outputGainRef.current);
      const loopNow = () => {
        if (playingRef.current?.mode !== "draft") return;
        if (playingRef.current.audio !== audio) return;
        const target = draftLoopSeekTarget(audio.currentTime, loopRef.current);
        if (target !== null) audio.currentTime = target;
      };
      const onFrame = () => {
        loopNow();
        draftFrameRef.current = requestAnimationFrame(onFrame);
      };
      const onDuration = () => {
        if (Number.isFinite(audio.duration) && audio.duration > 0) {
          setDraftDurations((known) =>
            known[key] === audio.duration
              ? known
              : { ...known, [key]: audio.duration },
          );
        }
      };
      audio.addEventListener("loadedmetadata", () => {
        onDuration();
        // Browsers without pre-metadata seeks start at 0: apply it now
        // (only when it was dropped, never over a later user seek).
        const target = clampSeek(offsetSec, audio.duration);
        if (target > 0.25 && audio.currentTime < 0.25) {
          audio.currentTime = target;
        }
      });
      audio.addEventListener("durationchange", onDuration);
      // rAF covers the visible tab; timeupdate keeps looping when hidden.
      audio.ontimeupdate = loopNow;
      audio.onended = () => {
        if (requestId !== requestRef.current) return;
        const activeLoop = loopRef.current;
        if (activeLoop) {
          // A loop reaching the end of the audio wraps instead of ending.
          audio.currentTime = activeLoop.startSec;
          void audio.play().catch(() => undefined);
          return;
        }
        halt(0);
        settleIdle();
      };
      audio.onerror = () => {
        if (requestId !== requestRef.current) return;
        halt(offsetSec);
        settleIdle();
        inputRef.current.onError("draft");
      };
      // Pre-metadata seek = the element's default start position.
      if (offsetSec > 0) audio.currentTime = offsetSec;
      playingRef.current = { mode: "draft", audio, key };
      await audio.play();
      if (requestId !== requestRef.current) {
        audio.pause();
        return;
      }
      cancelDraftFrame();
      draftFrameRef.current = requestAnimationFrame(onFrame);
      updateStatus("playing");
    } catch {
      if (requestId !== requestRef.current) return;
      halt(offsetSec);
      settleIdle();
      inputRef.current.onError("draft");
    }
  };

  /**
   * Start `next` at `offsetSec` (entered into the loop when one is set).
   * Synchronous up to engine.play()/audio.play() so the AudioContext resume
   * still counts as part of the user gesture.
   */
  const start = (
    next: TransportSource,
    offsetSec: number,
    activeLoop: TransportLoop | null,
  ): Promise<void> => {
    pauseGlobalPlayer();
    halt(offsetSec);
    const requestId = requestRef.current;
    const offset = activeLoop ? loopEntryOffset(offsetSec, activeLoop) : offsetSec;
    cursorRef.current = offset;
    setPreviewHandle(null);
    updateStatus("loading");
    return next.kind === "draft"
      ? startDraft(requestId, next, offset)
      : startEngine(requestId, next, offset, activeLoop);
  };
  // Stable identity for the public callbacks; always the latest closure.
  const startRef = useRef(start);
  startRef.current = start;

  const play = useCallback(async () => {
    const duration = durationRef.current;
    // The idle cursor, or the live playhead when (re)started while playing.
    let offset = currentPosition();
    // A cursor parked at the very end restarts from the top.
    if (duration !== null && offset >= duration - 0.05) offset = 0;
    await startRef.current(sourceRef.current, offset, loopRef.current);
  }, [currentPosition]);

  const stop = useCallback(() => {
    if (statusRef.current === "idle" && !playingRef.current) return;
    halt(null);
    settleIdle();
  }, [halt, settleIdle]);

  const toggle = useCallback(() => {
    if (statusRef.current === "idle") void play();
    else stop();
  }, [play, stop]);

  const seek = useCallback((sec: number) => {
    const target = clampSeek(sec, durationRef.current);
    if (statusRef.current === "idle") {
      cursorRef.current = target;
      setCursorRevision((revision) => revision + 1);
      return;
    }
    const playing = playingRef.current;
    const activeLoop = loopRef.current;
    if (playing?.mode === "draft") {
      // The element seeks in place; no reload.
      playing.audio.currentTime = activeLoop
        ? loopEntryOffset(target, activeLoop)
        : target;
      return;
    }
    void startRef.current(sourceRef.current, target, activeLoop);
  }, []);

  const setSource = useCallback((next: TransportSource) => {
    const previous = sourceRef.current;
    if (sameSource(previous, next)) return;
    sourceRef.current = next;
    setSourceState(next);
    if (statusRef.current === "idle") return;
    // Arrangement ↔ original is instant: the live-update effect flips the
    // reference gain on the running engine.
    if (isEngineSource(previous) && isEngineSource(next)) return;
    // To/from a draft: continue at the same position on the new source
    // (each start path clamps to its own audio length).
    void startRef.current(
      next,
      clampSeek(currentPosition(), null),
      loopRef.current,
    );
  }, [currentPosition]);

  const setLoop = useCallback((next: TransportLoop | null) => {
    loopRef.current = next;
    setLoopState(next);
    if (statusRef.current === "idle") return;
    const playing = playingRef.current;
    const position = currentPosition();
    const outside =
      next !== null && (position < next.startSec || position >= next.endSec);
    if (playing?.mode === "draft") {
      // The draft loop is enforced per frame; only jump in when outside it.
      if (next && outside) playing.audio.currentTime = next.startSec;
      return;
    }
    // Engine loops are fixed per start: restart, at the loop start when the
    // playhead is outside the new loop.
    void startRef.current(
      sourceRef.current,
      next && outside ? next.startSec : position,
      next,
    );
  }, [currentPosition]);

  const getPositionSec = useCallback(
    (): number | null => currentPosition(),
    // Identity changes on idle cursor moves so memoized consumers re-read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentPosition, cursorRevision],
  );

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  // The current draft's waveform loads eagerly (#1879): download into the
  // shared URL cache (play reuses it), then decode for peaks.
  const currentDraftKey = resolveDraftCacheKey(null, input.currentDraftJobId);
  useEffect(() => {
    if (!currentDraftKey || !input.token) return;
    let cancelled = false;
    fetchDraftUrl(currentDraftKey, null).then(
      (url) => {
        if (!cancelled && url) ensureDraftPeaks(currentDraftKey);
      },
      () => undefined, // Silent: the waveform just stays absent.
    );
    return () => {
      cancelled = true;
    };
  }, [currentDraftKey, ensureDraftPeaks, fetchDraftUrl, input.token]);

  const draftPeaksFor = useCallback(
    (jobId: string | null): number[] | null => {
      const key = resolveDraftCacheKey(jobId, input.currentDraftJobId);
      return key ? draftPeaks[key] ?? null : null;
    },
    [draftPeaks, input.currentDraftJobId],
  );

  // Preload every project stem: waveforms fill in as they decode and the
  // first play starts without a download.
  const stemIdsKey = useMemo(
    () => [...new Set(input.stemIds)].sort().join("\n"),
    [input.stemIds],
  );
  useEffect(() => {
    const ids = stemIdsKey ? stemIdsKey.split("\n") : [];
    if (ids.length === 0) {
      setBufferDurationSec(null);
      return;
    }
    let cancelled = false;
    const previewEngine = engine();
    setBufferDurationSec(previewEngine.bufferDuration(ids));
    void previewEngine.preload(ids, (stemId, buffer) => {
      if (cancelled) return;
      setBufferDurationSec(previewEngine.bufferDuration(ids));
      if (peaksDoneRef.current.has(stemId)) return;
      peaksDoneRef.current.add(stemId);
      const stemPeaks = computePeaks(buffer);
      setPeaks((known) => ({ ...known, [stemId]: stemPeaks }));
    });
    return () => {
      cancelled = true;
    };
  }, [engine, stemIdsKey]);

  // Live mixer edits while the engine plays: gains (and the arrangement ↔
  // original reference flip) apply on every change; section envelopes are
  // re-scheduled only when the spans themselves change.
  const engineStems = enginePreviewStems(
    input.previewStems,
    source,
    input.referenceStemId,
  );
  const engineStemsRef = useRef(engineStems);
  engineStemsRef.current = engineStems;
  const sectionsKey = previewSectionsKey(engineStems);
  const engineReference =
    source.kind === "original" ? input.referenceStemId : null;
  useEffect(() => {
    if (status !== "playing" || !previewHandle) return;
    previewHandle.update(
      engineStemsRef.current,
      inputRef.current.soloStemId,
      engineReference,
      inputRef.current.beat ?? null,
    );
  }, [
    engineReference,
    input.beat,
    input.previewStems,
    input.soloStemId,
    previewHandle,
    status,
  ]);
  useEffect(() => {
    if (status !== "playing" || !previewHandle) return;
    previewHandle.updateSections(engineStemsRef.current);
  }, [previewHandle, sectionsKey, status]);

  // Live effects edits (#1897): tone/echo/space/warmth apply in place; a
  // speed (or bpm) change — or effects appearing on a plain preview —
  // restarts at the current source position (the engine asks for it).
  const effectsKey = JSON.stringify([
    engineEffects(input.effects, source),
    input.bpm ?? null,
  ]);
  useEffect(() => {
    if (status !== "playing" || !previewHandle) return;
    const latest = inputRef.current;
    const outcome = previewHandle.updateEffects(
      engineEffects(latest.effects, sourceRef.current),
      latest.bpm ?? null,
    );
    if (outcome === "restart") {
      void startRef.current(
        sourceRef.current,
        currentPosition(),
        loopRef.current,
      );
    }
  }, [currentPosition, effectsKey, previewHandle, status]);

  // Structure edits (#1899): a changed timeline re-reads the looped block
  // and, while the engine plays, restarts at the same timeline position
  // (clamped to the new length). Equal refetched timelines change nothing.
  const timelineKey = structureTimelineKey(structure);
  const timelineKeyRef = useRef(timelineKey);
  useEffect(() => {
    if (timelineKeyRef.current === timelineKey) return;
    timelineKeyRef.current = timelineKey;
    const latest = inputRef.current;
    const nextLoop = loopForTimeline(loopRef.current, latest.timeline?.segments);
    loopRef.current = nextLoop;
    setLoopState(nextLoop);
    if (statusRef.current === "idle") {
      cursorRef.current = clampSeek(cursorRef.current, durationRef.current);
      setCursorRevision((revision) => revision + 1);
      return;
    }
    if (!isEngineSource(sourceRef.current)) return;
    void startRef.current(
      sourceRef.current,
      clampSeek(currentPosition(), durationRef.current),
      nextLoop,
    );
  }, [currentPosition, timelineKey]);

  // Beat edits (#1902): a change to what the beat sounds like (pattern,
  // kit, groove, blocks, timeline, or adding/removing it) restarts the
  // engine at the same position; level and mute apply live above.
  const beatKey = previewBeatKey(input.beat);
  const beatKeyRef = useRef(beatKey);
  useEffect(() => {
    if (beatKeyRef.current === beatKey) return;
    beatKeyRef.current = beatKey;
    if (statusRef.current === "idle") return;
    if (!isEngineSource(sourceRef.current)) return;
    void startRef.current(
      sourceRef.current,
      clampSeek(currentPosition(), durationRef.current),
      loopRef.current,
    );
  }, [beatKey, currentPosition]);

  // The beat's waveform (#1902): rebuilt once per beat key, debounced so a
  // burst of step toggles renders once (the engine keeps the last buffer by
  // key, so a play right after reuses it).
  useEffect(() => {
    const beat = inputRef.current.beat;
    if (!beat || !beatKey) return;
    return scheduleBeatPeaks({
      beat,
      key: beatKey,
      build: (next) => engine().beatBuffer(next),
      onPeaks: (key, beatPeaks) => {
        if (!unmountedRef.current) setBeatPeaksState({ key, peaks: beatPeaks });
      },
    });
  }, [beatKey, engine]);
  const beatPeaks =
    beatKey && beatPeaksState?.key === beatKey ? beatPeaksState.peaks : null;

  // A new generation replaces the current draft: drop its cached audio so
  // "Draft" plays the new one.
  useEffect(() => {
    const urls = draftUrlsRef.current;
    for (const [key, url] of [...urls]) {
      if (!key.startsWith("current:")) continue;
      if (key === resolveDraftCacheKey(null, input.currentDraftJobId)) continue;
      urls.delete(key);
      draftBlobsRef.current.delete(key);
      draftPeaksDoneRef.current.delete(key);
      const playing = playingRef.current;
      if (playing?.mode === "draft" && playing.key === key) {
        retiredUrlsRef.current.push(url);
      } else {
        URL.revokeObjectURL(url);
      }
    }
    // Its waveform goes with it.
    setDraftPeaks((known) =>
      dropStaleCurrentDraftKeys(known, input.currentDraftJobId),
    );
  }, [input.currentDraftJobId]);

  // Listening volume (#1910): live on whatever is playing, and on the
  // engine for the next play. A not-yet-created engine picks it up on
  // creation (and a new draft element on start).
  useEffect(() => {
    applyListeningGain(
      { engine: engineRef.current, playing: playingRef.current },
      outputGain,
    );
  }, [outputGain]);

  // The site-wide player just started (false → true): stop studio audio.
  // Studio audio started while the player was still flagged playing pauses
  // it (true → false) and must not be stopped by this effect.
  useEffect(() => {
    const wasPlaying = playerWasPlayingRef.current;
    playerWasPlayingRef.current = playerIsPlaying;
    if (wasPlaying || !playerIsPlaying) return;
    // A no-op when idle; also cancels anything mid-load.
    stop();
  }, [playerIsPlaying, stop]);

  useEffect(() => {
    const draftUrls = draftUrlsRef.current;
    const retiredUrls = retiredUrlsRef.current;
    const peaksDone = peaksDoneRef.current;
    const draftBlobs = draftBlobsRef.current;
    const draftDownloads = draftDownloadsRef.current;
    const draftPeaksDone = draftPeaksDoneRef.current;
    return () => {
      // Nothing still loading may start after unmount.
      halt(null);
      // Dispose stops any live preview, closes the AudioContext, and drops
      // the decoded-stem cache.
      engineRef.current?.dispose();
      engineRef.current = null;
      for (const url of draftUrls.values()) URL.revokeObjectURL(url);
      draftUrls.clear();
      for (const url of retiredUrls.splice(0)) URL.revokeObjectURL(url);
      draftBlobs.clear();
      draftDownloads.clear();
      // A remount (StrictMode) builds a fresh engine and re-decodes.
      peaksDone.clear();
      draftPeaksDone.clear();
    };
  }, [halt]);

  return {
    status,
    source,
    loop,
    previewHandle,
    peaks,
    beatPeaks,
    draftPeaksFor,
    durationSec,
    getPositionSec,
    play,
    stop,
    toggle,
    seek,
    setSource,
    setLoop,
  };
}
