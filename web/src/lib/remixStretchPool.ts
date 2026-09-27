/**
 * A small pool of stretch workers for the Remix Studio preview (#1898).
 * Jobs run first in, first out, one per worker. Cancelling a running job
 * terminates its worker (the WASM call can't be interrupted) and a new one
 * is spawned lazily for the next job; queued jobs are simply dropped.
 */

import type {
  StretchWorkerRequest,
  StretchWorkerResponse,
} from "./remixStretchProtocol";
import { STRETCH_JOB_ERROR } from "./remixStretchProtocol";

/** The Worker surface the pool uses (a fake in unit tests). */
export type StretchWorkerLike = {
  postMessage(message: StretchWorkerRequest, transfer: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<StretchWorkerResponse>) => void) | null;
  onerror: ((event: Event) => void) | null;
};

/**
 * A job: `channels` may be a thunk, called only when a worker takes the job,
 * so queued jobs don't hold copies of their audio (memory stays bounded by
 * the pool size).
 */
export type StretchJob = Omit<StretchWorkerRequest, "type" | "channels"> & {
  channels: Float32Array[] | (() => Float32Array[]);
};

/** Rejection reason of a cancelled (or disposed) job. */
export class StretchCancelledError extends Error {
  constructor() {
    super("The stretch was cancelled.");
    this.name = "StretchCancelledError";
  }
}

export type StretchPool = {
  /**
   * Queue a job; resolves with the stretched channels. The input channels
   * are transferred to the worker (unusable here afterwards).
   */
  run(job: StretchJob, onProgress?: (fraction: number) => void): Promise<Float32Array[]>;
  /** Drop queued jobs and terminate the workers running any of `jobIds`. */
  cancel(jobIds: Iterable<string>): void;
  /** Terminate every worker and reject every job. */
  dispose(): void;
};

/** `min(2, max(1, cores − 1))`: leaves a core for the page and audio. */
export function stretchPoolSize(hardwareConcurrency: number | undefined): number {
  return Math.min(2, Math.max(1, (hardwareConcurrency ?? 2) - 1));
}

/** The real module worker (webpack bundles the entry from this pattern). */
export function createStretchWorker(): StretchWorkerLike {
  return new Worker(new URL("./remixStretch.worker.ts", import.meta.url), {
    type: "module",
  }) as unknown as StretchWorkerLike;
}

type Pending = {
  job: StretchJob;
  onProgress?: (fraction: number) => void;
  resolve(channels: Float32Array[]): void;
  reject(error: Error): void;
};

type Slot = { worker: StretchWorkerLike | null; job: Pending | null };

export function createStretchPool(
  options: {
    createWorker?: () => StretchWorkerLike;
    size?: number;
  } = {},
): StretchPool {
  const createWorker = options.createWorker ?? createStretchWorker;
  const slots: Slot[] = Array.from(
    {
      length: Math.max(
        1,
        options.size ??
          stretchPoolSize(
            typeof navigator === "undefined" ? undefined : navigator.hardwareConcurrency,
          ),
      ),
    },
    () => ({ worker: null, job: null }),
  );
  const queue: Pending[] = [];
  let disposed = false;

  const retire = (slot: Slot) => {
    if (slot.worker) {
      slot.worker.onmessage = null;
      slot.worker.onerror = null;
      slot.worker.terminate();
    }
    slot.worker = null;
  };

  const settle = (slot: Slot) => {
    slot.job = null;
    pump();
  };

  const spawn = (slot: Slot): StretchWorkerLike => {
    const worker = createWorker();
    worker.onmessage = (event) => {
      const message = event.data;
      const running = slot.job;
      if (!running || message.jobId !== running.job.jobId) return;
      if (message.type === "progress") {
        running.onProgress?.(message.fraction);
      } else if (message.type === "done") {
        settle(slot);
        running.resolve(message.channels);
      } else {
        settle(slot);
        running.reject(new Error(message.message));
      }
    };
    worker.onerror = (event) => {
      // The worker itself failed (e.g. its script didn't load): fail the
      // job and start from a fresh worker next time.
      event.preventDefault?.();
      const running = slot.job;
      retire(slot);
      settle(slot);
      running?.reject(new Error(STRETCH_JOB_ERROR));
    };
    slot.worker = worker;
    return worker;
  };

  const pump = () => {
    if (disposed) return;
    for (const slot of slots) {
      if (slot.job) continue;
      const next = queue.shift();
      if (!next) return;
      slot.job = next;
      let worker: StretchWorkerLike;
      try {
        worker = slot.worker ?? spawn(slot);
      } catch {
        slot.job = null;
        next.reject(new Error(STRETCH_JOB_ERROR));
        continue;
      }
      const { job } = next;
      const channels =
        typeof job.channels === "function" ? job.channels() : job.channels;
      worker.postMessage(
        { type: "stretch", ...job, channels },
        channels.map((channel) => channel.buffer),
      );
    }
  };

  return {
    run(job, onProgress) {
      if (disposed) return Promise.reject(new StretchCancelledError());
      return new Promise<Float32Array[]>((resolve, reject) => {
        queue.push({ job, onProgress, resolve, reject });
        pump();
      });
    },
    cancel(jobIds) {
      const ids = new Set(jobIds);
      if (ids.size === 0) return;
      for (let i = queue.length - 1; i >= 0; i -= 1) {
        if (ids.has(queue[i].job.jobId)) {
          const [dropped] = queue.splice(i, 1);
          dropped.reject(new StretchCancelledError());
        }
      }
      for (const slot of slots) {
        const running = slot.job;
        if (!running || !ids.has(running.job.jobId)) continue;
        retire(slot);
        slot.job = null;
        running.reject(new StretchCancelledError());
      }
      pump();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const pending of queue.splice(0)) {
        pending.reject(new StretchCancelledError());
      }
      for (const slot of slots) {
        const running = slot.job;
        retire(slot);
        slot.job = null;
        running?.reject(new StretchCancelledError());
      }
    },
  };
}
