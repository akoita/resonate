import { Injectable, Logger } from "@nestjs/common";
import { prisma } from "../../db/prisma";

/**
 * Audio analysis metrics computed from a stem's raw audio data.
 * Each metric is normalised to the [0.0 – 1.0] range.
 */
export interface StemAudioMetrics {
  /** Root-mean-square energy of the signal */
  rmsEnergy: number;
  /** Tonal richness — fraction of active frequency bins */
  spectralDensity: number;
  /** Fraction of frames that are considered silent */
  silenceRatio: number;
  /** Heuristic combining energy, spectral spread, and non-silence */
  musicalSalience: number;
}

/** Weights for composing the final 0-100 quality score. */
const SCORE_WEIGHTS = {
  rmsEnergy: 0.25,
  spectralDensity: 0.3,
  silenceRatio: 0.25, // inverted: (1 - silenceRatio)
  musicalSalience: 0.2,
};

/**
 * CuratorAgentService analyses stem audio quality and persists ratings
 * so buyer agents can make quality-aware purchasing decisions.
 *
 * Audio analysis is powered by essentia.js (WASM-compiled Essentia C++).
 * On-chain ERC-8004 task publishing will be added when #261/#291 land.
 */
@Injectable()
export class CuratorAgentService {
  private readonly logger = new Logger(CuratorAgentService.name);
  private essentiaInstance: any = null;

  // ────────────────────────────────────────────────
  // Public API
  // ────────────────────────────────────────────────

  /**
   * Analyse a single stem and persist the quality rating.
   * If a rating from the same curator already exists it is upserted.
   */
  async analyzeStem(
    stemId: string,
    curatorId: string = "system",
  ): Promise<{
    score: number;
    metrics: StemAudioMetrics;
    stemId: string;
  }> {
    const stem = await prisma.stem.findUnique({ where: { id: stemId } });
    if (!stem) {
      throw new Error(`Stem not found: ${stemId}`);
    }

    // Fetch raw audio data
    const audioBuffer = await this.fetchStemAudio(stem);
    if (!audioBuffer || audioBuffer.length === 0) {
      throw new Error(`No audio data available for stem: ${stemId}`);
    }

    // Compute metrics via essentia
    const metrics = await this.computeMetrics(audioBuffer);
    const score = this.computeScore(metrics);

    // Persist rating (upsert by stemId + curatorId)
    await prisma.stemQualityRating.upsert({
      where: { stemId_curatorId: { stemId, curatorId } },
      create: {
        stemId,
        curatorId,
        score,
        rmsEnergy: metrics.rmsEnergy,
        spectralDensity: metrics.spectralDensity,
        silenceRatio: metrics.silenceRatio,
        musicalSalience: metrics.musicalSalience,
        analysisJson: metrics as any,
      },
      update: {
        score,
        rmsEnergy: metrics.rmsEnergy,
        spectralDensity: metrics.spectralDensity,
        silenceRatio: metrics.silenceRatio,
        musicalSalience: metrics.musicalSalience,
        analysisJson: metrics as any,
      },
    });

    this.logger.log(
      `Rated stem ${stemId}: score=${score} (rms=${metrics.rmsEnergy.toFixed(3)}, ` +
        `spectral=${metrics.spectralDensity.toFixed(3)}, silence=${metrics.silenceRatio.toFixed(3)}, ` +
        `salience=${metrics.musicalSalience.toFixed(3)})`,
    );

    return { score, metrics, stemId };
  }

  /**
   * Batch-analyse all stems belonging to a track.
   */
  async analyzeTrackStems(
    trackId: string,
    curatorId: string = "system",
  ): Promise<{ stemId: string; score: number; type: string }[]> {
    const stems = await prisma.stem.findMany({ where: { trackId } });
    const results: { stemId: string; score: number; type: string }[] = [];

    for (const stem of stems) {
      try {
        const { score } = await this.analyzeStem(stem.id, curatorId);
        results.push({ stemId: stem.id, score, type: stem.type });
      } catch (err) {
        this.logger.warn(`Failed to analyse stem ${stem.id}: ${err}`);
        results.push({ stemId: stem.id, score: 0, type: stem.type });
      }
    }

    return results;
  }

  /**
   * Look up quality ratings for a set of stems by their IDs.
   * Returns the highest-scored rating per stem.
   */
  async lookupQuality(
    stemIds: string[],
  ): Promise<Map<string, { score: number; curatorId: string }>> {
    if (stemIds.length === 0) return new Map();

    const ratings = await prisma.stemQualityRating.findMany({
      where: { stemId: { in: stemIds } },
      orderBy: { score: "desc" },
    });

    const best = new Map<string, { score: number; curatorId: string }>();
    for (const r of ratings) {
      if (!best.has(r.stemId)) {
        best.set(r.stemId, { score: r.score, curatorId: r.curatorId });
      }
    }
    return best;
  }

  /**
   * Look up the average quality score for stems belonging to given track IDs.
   * Returns a map of trackId → average score (0-100). Tracks with no ratings
   * are not included in the result.
   */
  async lookupTrackQuality(
    trackIds: string[],
  ): Promise<Map<string, number>> {
    if (trackIds.length === 0) return new Map();

    const stems = await prisma.stem.findMany({
      where: { trackId: { in: trackIds } },
      select: {
        id: true,
        trackId: true,
        qualityRatings: {
          select: { score: true },
          orderBy: { score: "desc" },
          take: 1, // best rating per stem
        },
      },
    });

    // Group by track and compute average stem quality
    const trackScores = new Map<string, number[]>();
    for (const stem of stems) {
      if (stem.qualityRatings.length > 0) {
        const scores = trackScores.get(stem.trackId) ?? [];
        scores.push(stem.qualityRatings[0].score);
        trackScores.set(stem.trackId, scores);
      }
    }

    const result = new Map<string, number>();
    for (const [trackId, scores] of trackScores) {
      const avg = Math.round(scores.reduce((s, v) => s + v, 0) / scores.length);
      result.set(trackId, avg);
    }
    return result;
  }

  // ────────────────────────────────────────────────
  // Audio analysis (essentia.js)
  // ────────────────────────────────────────────────

  /**
   * Compute audio quality metrics from raw WAV/PCM data using essentia.js.
   *
   * Falls back to a lightweight pure-JS analysis if essentia fails to
   * initialise (e.g. in test environments without WASM support).
   */
  async computeMetrics(audioBuffer: Buffer): Promise<StemAudioMetrics> {
    const samples = this.decodeWav(audioBuffer);
    if (samples.length === 0) {
      return { rmsEnergy: 0, spectralDensity: 0, silenceRatio: 1, musicalSalience: 0 };
    }

    try {
      const essentia = await this.getEssentia();
      return this.computeWithEssentia(essentia, samples);
    } catch {
      this.logger.warn("Essentia unavailable — falling back to pure-JS analysis");
      return this.computePureJs(samples);
    }
  }

  /**
   * Weighted composite: 0-100 integer score.
   */
  computeScore(metrics: StemAudioMetrics): number {
    const raw =
      metrics.rmsEnergy * SCORE_WEIGHTS.rmsEnergy +
      metrics.spectralDensity * SCORE_WEIGHTS.spectralDensity +
      (1 - metrics.silenceRatio) * SCORE_WEIGHTS.silenceRatio +
      metrics.musicalSalience * SCORE_WEIGHTS.musicalSalience;

    return Math.round(Math.max(0, Math.min(1, raw)) * 100);
  }

  // ────────────────────────────────────────────────
  // Private — essentia.js helpers
  // ────────────────────────────────────────────────

  private async getEssentia(): Promise<any> {
    if (this.essentiaInstance) return this.essentiaInstance;

    // Dynamic import to allow tree-shaking and avoid issues in test envs
    const { Essentia, EssentiaWASM } = await import("essentia.js");
    const wasmModule = await EssentiaWASM();
    this.essentiaInstance = new Essentia(wasmModule);
    return this.essentiaInstance;
  }

  private computeWithEssentia(essentia: any, samples: Float32Array): StemAudioMetrics {
    // Create an essentia vector from samples
    const vector = essentia.arrayToVector(samples);

    // RMS energy — normalised against a reference level
    const rmsResult = essentia.RMS(vector);
    const rmsRaw = rmsResult?.rms ?? 0;
    // Normalise: typical stem RMS is 0.01–0.3; map to 0–1
    const rmsEnergy = Math.min(1, rmsRaw / 0.25);

    // Spectral centroid as proxy for tonal richness
    let spectralDensity = 0;
    try {
      const spectrum = essentia.Spectrum(vector);
      const centroidResult = essentia.SpectralCentroidTime(vector);
      const centroid = centroidResult?.centroid ?? 0;
      // Normalise: centroid in Hz, typical music 500–5000 Hz
      spectralDensity = Math.min(1, centroid / 4000);

      // Energy band ratio as secondary spectral metric
      const energyResult = essentia.EnergyBandRatio(
        spectrum.spectrum,
        22050, // sampleRate
        200,   // startFreq
        4000,  // stopFreq
      );
      const bandRatio = energyResult?.energyBandRatio ?? 0;
      // Blend centroid and band ratio
      spectralDensity = Math.min(1, spectralDensity * 0.6 + bandRatio * 0.4);
    } catch {
      // Fallback to pure centroid estimate
      spectralDensity = Math.min(1, rmsRaw * 2);
    }

    // Silence ratio via StartStopSilence
    let silenceRatio = 0;
    try {
      const silenceResult = essentia.StartStopSilence(vector);
      const startFrame = silenceResult?.startFrame ?? 0;
      const stopFrame = silenceResult?.stopFrame ?? samples.length;
      const totalFrames = samples.length;
      const activeFrames = Math.max(0, stopFrame - startFrame);
      silenceRatio = 1 - Math.min(1, activeFrames / totalFrames);
    } catch {
      // Fallback: count silent samples
      silenceRatio = this.computeSilenceRatioFallback(samples);
    }

    // Musical salience — heuristic combining metrics
    const musicalSalience = this.computeSalience(rmsEnergy, spectralDensity, silenceRatio);

    return { rmsEnergy, spectralDensity, silenceRatio, musicalSalience };
  }

  /**
   * Pure-JS fallback for environments without WASM (tests, CI, etc.)
   */
  private computePureJs(samples: Float32Array): StemAudioMetrics {
    // RMS energy
    let sumSq = 0;
    for (let i = 0; i < samples.length; i++) {
      sumSq += samples[i] * samples[i];
    }
    const rmsRaw = Math.sqrt(sumSq / samples.length);
    const rmsEnergy = Math.min(1, rmsRaw / 0.25);

    // Silence ratio: frames below threshold
    const silenceRatio = this.computeSilenceRatioFallback(samples);

    // Basic spectral density via zero-crossing rate as proxy
    let zeroCrossings = 0;
    for (let i = 1; i < samples.length; i++) {
      if ((samples[i] >= 0 && samples[i - 1] < 0) || (samples[i] < 0 && samples[i - 1] >= 0)) {
        zeroCrossings++;
      }
    }
    const zcr = zeroCrossings / samples.length;
    // Higher ZCR = more spectral content; normalise (typical 0.01-0.3)
    const spectralDensity = Math.min(1, zcr / 0.2);

    const musicalSalience = this.computeSalience(rmsEnergy, spectralDensity, silenceRatio);

    return { rmsEnergy, spectralDensity, silenceRatio, musicalSalience };
  }

  private computeSilenceRatioFallback(samples: Float32Array): number {
    const frameSize = 1024;
    const threshold = 0.005; // -46 dBFS
    let silentFrames = 0;
    let totalFrames = 0;

    for (let i = 0; i < samples.length; i += frameSize) {
      const end = Math.min(i + frameSize, samples.length);
      let frameSumSq = 0;
      for (let j = i; j < end; j++) {
        frameSumSq += samples[j] * samples[j];
      }
      const frameRms = Math.sqrt(frameSumSq / (end - i));
      if (frameRms < threshold) silentFrames++;
      totalFrames++;
    }

    return totalFrames > 0 ? silentFrames / totalFrames : 1;
  }

  private computeSalience(rmsEnergy: number, spectralDensity: number, silenceRatio: number): number {
    // Musical salience is high when: energy is present, spectrum is rich, silence is low
    const activeRatio = 1 - silenceRatio;
    return Math.min(1, (rmsEnergy * 0.3 + spectralDensity * 0.4 + activeRatio * 0.3));
  }

  // ────────────────────────────────────────────────
  // Audio data helpers
  // ────────────────────────────────────────────────

  /**
   * Fetch stem audio as a raw Buffer.
   * Uses the `data` field if present (in-DB), otherwise reads from `uri`.
   */
  private async fetchStemAudio(stem: {
    data: Buffer | null;
    uri: string;
    storageProvider: string;
  }): Promise<Buffer> {
    if (stem.data && stem.data.length > 0) {
      return Buffer.from(stem.data);
    }

    // For local/IPFS storage, read from the filesystem
    const fs = await import("fs/promises");
    try {
      return await fs.readFile(stem.uri);
    } catch {
      throw new Error(`Cannot read stem audio from ${stem.storageProvider}:${stem.uri}`);
    }
  }

  /**
   * Decode a WAV buffer into Float32 PCM samples.
   * Supports 16-bit and 24-bit PCM. Returns mono (first channel only).
   */
  decodeWav(buffer: Buffer): Float32Array {
    if (buffer.length < 44) return new Float32Array(0);

    // Parse WAV header
    const riff = buffer.toString("ascii", 0, 4);
    if (riff !== "RIFF") {
      // Not a WAV — treat as raw 16-bit PCM
      return this.decodeRawPcm16(buffer);
    }

    const numChannels = buffer.readUInt16LE(22);
    const bitsPerSample = buffer.readUInt16LE(34);
    const bytesPerSample = bitsPerSample / 8;

    // Find data chunk
    let dataOffset = 44; // standard offset
    for (let i = 36; i < Math.min(buffer.length - 8, 200); i++) {
      if (buffer.toString("ascii", i, i + 4) === "data") {
        dataOffset = i + 8;
        break;
      }
    }

    const dataLength = buffer.length - dataOffset;
    const numSamples = Math.floor(dataLength / (numChannels * bytesPerSample));
    const samples = new Float32Array(numSamples);

    for (let i = 0; i < numSamples; i++) {
      const offset = dataOffset + i * numChannels * bytesPerSample;
      if (offset + bytesPerSample > buffer.length) break;

      if (bitsPerSample === 16) {
        samples[i] = buffer.readInt16LE(offset) / 32768;
      } else if (bitsPerSample === 24) {
        const b0 = buffer[offset];
        const b1 = buffer[offset + 1];
        const b2 = buffer[offset + 2];
        const val = (b2 << 16) | (b1 << 8) | b0;
        samples[i] = (val > 0x7fffff ? val - 0x1000000 : val) / 8388608;
      } else if (bitsPerSample === 32) {
        samples[i] = buffer.readFloatLE(offset);
      } else {
        samples[i] = buffer.readInt16LE(offset) / 32768;
      }
    }

    return samples;
  }

  private decodeRawPcm16(buffer: Buffer): Float32Array {
    const numSamples = Math.floor(buffer.length / 2);
    const samples = new Float32Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
      samples[i] = buffer.readInt16LE(i * 2) / 32768;
    }
    return samples;
  }
}
