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
};

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
        source.buffer = buffer;
        source.connect(gain).connect(audioContext.destination);
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
  for (const source of sources) {
    source.start(startAt);
  }

  return { update, stop };
}
