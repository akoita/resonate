/**
 * Message protocol of the Remix Studio stretch worker (#1898) and the job it
 * runs, kept out of the worker entry so the pool and the tests can import
 * them. The worker (`remixStretch.worker.ts`) is a thin shell over
 * {@link runStretchJob}.
 */

import {
  createStretchEngine,
  fetchRemixStretchWasm,
  stretchOffline,
} from "./remixStretch";

/** One stem to stretch; `channels` are transferred to the worker. */
export type StretchWorkerRequest = {
  type: "stretch";
  jobId: string;
  sampleRate: number;
  tempo: number;
  semitones: number;
  channels: Float32Array[];
};

export type StretchWorkerResponse =
  | { type: "progress"; jobId: string; fraction: number }
  /** The stretched channels, transferred back. */
  | { type: "done"; jobId: string; channels: Float32Array[] }
  /** `message` is plain language, safe to show. */
  | { type: "error"; jobId: string; message: string };

/** Progress is posted about every 5% of a job. */
export const STRETCH_PROGRESS_STEP = 0.05;

export const STRETCH_ENGINE_LOAD_ERROR =
  "The tempo & key engine couldn't load.";
export const STRETCH_JOB_ERROR = "The tempo & key change couldn't be applied.";

/** Reports only when the fraction moved by `step` since the last report. */
export function throttleProgress(
  report: (fraction: number) => void,
  step: number = STRETCH_PROGRESS_STEP,
): (fraction: number) => void {
  let last = 0;
  return (fraction) => {
    if (fraction - last >= step - 1e-9 || (fraction >= 1 && last < 1)) {
      last = fraction;
      report(fraction);
    }
  };
}

/**
 * The compiled engine, fetched and verified once per worker; a failed load
 * is forgotten so the next job retries it.
 */
export function createStretchModuleLoader(
  load: () => Promise<ArrayBuffer> = () => fetchRemixStretchWasm(),
): () => Promise<WebAssembly.Module> {
  let compiled: Promise<WebAssembly.Module> | null = null;
  return () => {
    if (!compiled) {
      const pending = load().then((bytes) => WebAssembly.compile(bytes));
      compiled = pending;
      pending.catch(() => {
        if (compiled === pending) compiled = null;
      });
    }
    return compiled;
  };
}

/**
 * Run one job: a FRESH engine per job (so the output is deterministic, like
 * the offline reference) and the pinned driver with the server render's
 * zero-pad/trim rule for input shorter than the engine minimum. Posts
 * throttled progress, then the result or a plain-language error.
 */
export async function runStretchJob(
  request: StretchWorkerRequest,
  loadModule: () => Promise<WebAssembly.Module>,
  post: (message: StretchWorkerResponse, transfer?: Transferable[]) => void,
): Promise<void> {
  const { jobId } = request;
  let compiled: WebAssembly.Module;
  try {
    compiled = await loadModule();
  } catch {
    post({ type: "error", jobId, message: STRETCH_ENGINE_LOAD_ERROR });
    return;
  }
  try {
    const api = await createStretchEngine(compiled);
    const { out } = stretchOffline(
      api,
      request.channels,
      request.sampleRate,
      { tempo: request.tempo, semitones: request.semitones },
      {
        padToMinimum: true,
        onProgress: throttleProgress((fraction) =>
          post({ type: "progress", jobId, fraction }),
        ),
      },
    );
    post(
      { type: "done", jobId, channels: out },
      out.map((channel) => channel.buffer),
    );
  } catch {
    post({ type: "error", jobId, message: STRETCH_JOB_ERROR });
  }
}
