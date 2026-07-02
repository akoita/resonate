export type RemixDraftOutputMetadata = {
  outputUri: string | null;
  mimeType?: string | null;
  synthIdPresent?: boolean | null;
  seed?: number | null;
  sampleRate?: number | null;
};

export type RemixGenerationMetadata = {
  output?: RemixDraftOutputMetadata | null;
};

export type PreviewStemState = {
  stemId: string;
  gainDb: number | null;
  muted: boolean;
  /**
   * Section-grid play spans (#1314): undefined/null = whole stem plays;
   * [] = every section off (silent); otherwise the preview schedules a gain
   * envelope over these spans, mirroring the server render's gating.
   */
  activeIntervals?: Array<{ startSec: number; endSec: number }> | null;
};

/** Matches the server render's section edge fade (SECTION_FADE_SECONDS). */
export const PREVIEW_SECTION_FADE_SECONDS = 0.05;

type SchedulableParam = {
  setValueAtTime(value: number, time: number): unknown;
  linearRampToValueAtTime(value: number, time: number): unknown;
};

/**
 * Schedule the section envelope on a dedicated gain param, relative to the
 * preview's start time. Pure over an AudioParam-like interface so it is
 * testable without a real AudioContext. Live mute/solo/gain stay on the
 * separate manual gain node and never fight this automation.
 */
export function scheduleSectionEnvelope(
  param: SchedulableParam,
  intervals: Array<{ startSec: number; endSec: number }> | null | undefined,
  startAt: number,
  fadeSeconds: number = PREVIEW_SECTION_FADE_SECONDS,
): void {
  if (intervals === null || intervals === undefined) {
    param.setValueAtTime(1, startAt);
    return;
  }
  if (intervals.length === 0) {
    param.setValueAtTime(0, startAt);
    return;
  }
  const fade = Math.max(fadeSeconds, 0.001);
  param.setValueAtTime(intervals[0].startSec <= 0 ? 1 : 0, startAt);
  for (const interval of intervals) {
    if (interval.startSec > 0) {
      param.setValueAtTime(0, startAt + interval.startSec);
      param.linearRampToValueAtTime(1, startAt + interval.startSec + fade);
    }
    const fadeOutStart = Math.max(
      interval.endSec - fade,
      interval.startSec > 0 ? interval.startSec + fade : 0,
    );
    param.setValueAtTime(1, startAt + fadeOutStart);
    param.linearRampToValueAtTime(0, startAt + interval.endSec);
  }
}

export type StemArrangementPreviewHandle = {
  update(stems: PreviewStemState[], soloStemId: string | null): void;
  stop(): void;
};

type BrowserAudioContext = AudioContext & {
  close(): Promise<void>;
};

type AudioContextConstructor = new () => BrowserAudioContext;

export function dbToLinearGain(db: number | null | undefined): number {
  const value = typeof db === "number" && Number.isFinite(db) ? db : 0;
  return Math.pow(10, value / 20);
}

export function stemPreviewGain(
  stem: PreviewStemState,
  soloStemId: string | null,
): number {
  if (stem.muted) return 0;
  if (soloStemId && soloStemId !== stem.stemId) return 0;
  return dbToLinearGain(stem.gainDb);
}

export function remixDraftOutputUri(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const output = (metadata as RemixGenerationMetadata).output;
  if (!output || typeof output !== "object") return null;
  return typeof output.outputUri === "string" && output.outputUri.trim()
    ? output.outputUri
    : null;
}

function audioContextConstructor(): AudioContextConstructor {
  if (typeof window === "undefined") {
    throw new Error("Audio preview is not available in this environment.");
  }
  const contextWindow = window as Window & {
    webkitAudioContext?: AudioContextConstructor;
  };
  const constructor = window.AudioContext ?? contextWindow.webkitAudioContext;
  if (!constructor) {
    throw new Error("Audio preview is not supported by this browser.");
  }
  return constructor as AudioContextConstructor;
}

export async function startStemArrangementPreview(input: {
  stems: PreviewStemState[];
  soloStemId: string | null;
  urlForStem: (stemId: string) => string;
  onEnded?: () => void;
}): Promise<StemArrangementPreviewHandle> {
  const AudioContextCtor = audioContextConstructor();
  const audioContext = new AudioContextCtor();
  const sources: AudioBufferSourceNode[] = [];
  const gains = new Map<string, GainNode>();
  const sectionGains = new Map<string, GainNode>();
  let stopped = false;
  let endedCount = 0;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    for (const source of sources) {
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
      source.disconnect();
    }
    for (const gain of gains.values()) {
      gain.disconnect();
    }
    for (const gain of sectionGains.values()) {
      gain.disconnect();
    }
    void audioContext.close();
  };

  try {
    await Promise.all(
      input.stems.map(async (stem) => {
        const response = await fetch(input.urlForStem(stem.stemId));
        if (!response.ok) {
          throw new Error(`Stem preview unavailable for ${stem.stemId}`);
        }
        const data = await response.arrayBuffer();
        const buffer = await audioContext.decodeAudioData(data.slice(0));
        const source = audioContext.createBufferSource();
        const gain = audioContext.createGain();
        // Section envelope (#1314) lives on its own node so scheduled
        // automation and live manual-gain updates never conflict.
        const sectionGain = audioContext.createGain();
        source.buffer = buffer;
        source
          .connect(gain)
          .connect(sectionGain)
          .connect(audioContext.destination);
        sectionGains.set(stem.stemId, sectionGain);
        source.onended = () => {
          endedCount += 1;
          if (!stopped && endedCount >= sources.length) {
            stopped = true;
            for (const node of gains.values()) node.disconnect();
            void audioContext.close();
            input.onEnded?.();
          }
        };
        sources.push(source);
        gains.set(stem.stemId, gain);
      }),
    );
  } catch (error) {
    stop();
    throw error;
  }

  const update = (stems: PreviewStemState[], soloStemId: string | null) => {
    for (const stem of stems) {
      const gain = gains.get(stem.stemId);
      if (gain) {
        gain.gain.value = stemPreviewGain(stem, soloStemId);
      }
    }
  };

  update(input.stems, input.soloStemId);
  const startAt = audioContext.currentTime + 0.03;
  // Section envelopes are scheduled once at start from the current
  // arrangement; cell edits during playback apply on the next preview start.
  for (const stem of input.stems) {
    const sectionGain = sectionGains.get(stem.stemId);
    if (sectionGain) {
      scheduleSectionEnvelope(sectionGain.gain, stem.activeIntervals, startAt);
    }
  }
  for (const source of sources) {
    source.start(startAt);
  }

  return { update, stop };
}
