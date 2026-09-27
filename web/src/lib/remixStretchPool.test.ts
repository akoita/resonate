import { describe, expect, it } from "vitest";
import {
  createStretchPool,
  StretchCancelledError,
  stretchPoolSize,
  type StretchJob,
  type StretchWorkerLike,
} from "./remixStretchPool";
import {
  STRETCH_JOB_ERROR,
  type StretchWorkerRequest,
  type StretchWorkerResponse,
} from "./remixStretchProtocol";

/** A fake Worker: records posts, lets the test answer or fail them. */
class FakeWorker implements StretchWorkerLike {
  onmessage: ((event: MessageEvent<StretchWorkerResponse>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  posted: StretchWorkerRequest[] = [];
  transfers: Transferable[][] = [];
  terminated = false;
  postMessage(message: StretchWorkerRequest, transfer: Transferable[]) {
    this.posted.push(message);
    this.transfers.push(transfer);
  }
  terminate() {
    this.terminated = true;
  }
  reply(message: StretchWorkerResponse) {
    this.onmessage?.({ data: message } as MessageEvent<StretchWorkerResponse>);
  }
  crash() {
    this.onerror?.({ preventDefault: () => undefined } as Event);
  }
}

function setup(size = 1) {
  const workers: FakeWorker[] = [];
  const pool = createStretchPool({
    size,
    createWorker: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    },
  });
  return { pool, workers };
}

const job = (jobId: string): StretchJob => ({
  jobId,
  sampleRate: 48_000,
  tempo: 0.85,
  semitones: 2,
  channels: [new Float32Array(4), new Float32Array(4)],
});

const settled = <T,>(promise: Promise<T>) => {
  const state: { value?: T; error?: unknown; done: boolean } = { done: false };
  promise.then(
    (value) => Object.assign(state, { value, done: true }),
    (error) => Object.assign(state, { error, done: true }),
  );
  return state;
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("stretchPoolSize (#1898)", () => {
  it("uses cores − 1, at least one and at most two workers", () => {
    expect(stretchPoolSize(1)).toBe(1);
    expect(stretchPoolSize(2)).toBe(1);
    expect(stretchPoolSize(3)).toBe(2);
    expect(stretchPoolSize(16)).toBe(2);
    expect(stretchPoolSize(undefined)).toBe(1);
  });
});

describe("createStretchPool (#1898)", () => {
  it("runs jobs first in, first out, and transfers the channels", async () => {
    const { pool, workers } = setup(1);
    const first = job("a");
    const a = settled(pool.run(first));
    const b = settled(pool.run(job("b")));
    expect(workers).toHaveLength(1);
    expect(workers[0].posted.map((message) => message.jobId)).toEqual(["a"]);
    expect(workers[0].posted[0]).toMatchObject({ type: "stretch", tempo: 0.85, semitones: 2 });
    expect(workers[0].transfers[0]).toEqual(
      (first.channels as Float32Array[]).map((channel) => channel.buffer),
    );

    const out = [new Float32Array(5)];
    workers[0].reply({ type: "done", jobId: "a", channels: out });
    await flush();
    expect(a.value).toBe(out);
    // The same worker takes the next job.
    expect(workers).toHaveLength(1);
    expect(workers[0].posted.map((message) => message.jobId)).toEqual(["a", "b"]);
    expect(b.done).toBe(false);
  });

  it("copies lazy channels only when a worker takes the job", async () => {
    const { pool, workers } = setup(1);
    void pool.run(job("a"));
    const lazy = new Float32Array(3);
    let copies = 0;
    const b = settled(
      pool.run({
        ...job("b"),
        channels: () => {
          copies += 1;
          return [lazy];
        },
      }),
    );
    expect(copies).toBe(0);
    workers[0].reply({ type: "done", jobId: "a", channels: [] });
    await flush();
    expect(copies).toBe(1);
    expect(workers[0].posted[1].channels).toEqual([lazy]);
    expect(workers[0].transfers[1]).toEqual([lazy.buffer]);
    expect(b.done).toBe(false);
  });

  it("spreads jobs over the pool's workers", () => {
    const { pool, workers } = setup(2);
    void pool.run(job("a"));
    void pool.run(job("b"));
    void pool.run(job("c"));
    expect(workers.map((worker) => worker.posted.map((message) => message.jobId))).toEqual([
      ["a"],
      ["b"],
    ]);
  });

  it("forwards progress for the running job only", () => {
    const { pool, workers } = setup(1);
    const seen: number[] = [];
    void pool.run(job("a"), (fraction) => seen.push(fraction));
    workers[0].reply({ type: "progress", jobId: "a", fraction: 0.25 });
    workers[0].reply({ type: "progress", jobId: "other", fraction: 0.5 });
    workers[0].reply({ type: "progress", jobId: "a", fraction: 0.3 });
    expect(seen).toEqual([0.25, 0.3]);
  });

  it("cancel terminates the busy worker, drops queued jobs, and respawns lazily", async () => {
    const { pool, workers } = setup(1);
    const a = settled(pool.run(job("a")));
    const b = settled(pool.run(job("b")));
    const c = settled(pool.run(job("c")));
    pool.cancel(["a", "b"]);
    await flush();
    expect(a.error).toBeInstanceOf(StretchCancelledError);
    expect(b.error).toBeInstanceOf(StretchCancelledError);
    expect(workers[0].terminated).toBe(true);
    // The remaining job starts on a fresh worker.
    expect(workers).toHaveLength(2);
    expect(workers[1].posted.map((message) => message.jobId)).toEqual(["c"]);
    // A late reply from the terminated worker changes nothing.
    workers[0].reply({ type: "done", jobId: "a", channels: [] });
    workers[1].reply({ type: "done", jobId: "c", channels: [] });
    await flush();
    expect(c.value).toEqual([]);
  });

  it("cancelling only queued jobs keeps the busy worker", async () => {
    const { pool, workers } = setup(1);
    void pool.run(job("a"));
    const b = settled(pool.run(job("b")));
    pool.cancel(["b"]);
    await flush();
    expect(b.error).toBeInstanceOf(StretchCancelledError);
    expect(workers[0].terminated).toBe(false);
  });

  it("rejects with the worker's plain-language error and keeps the worker", async () => {
    const { pool, workers } = setup(1);
    const a = settled(pool.run(job("a")));
    const b = settled(pool.run(job("b")));
    workers[0].reply({ type: "error", jobId: "a", message: "Nope, in plain words." });
    await flush();
    expect((a.error as Error).message).toBe("Nope, in plain words.");
    expect(workers).toHaveLength(1);
    expect(workers[0].posted.map((message) => message.jobId)).toEqual(["a", "b"]);
    expect(b.done).toBe(false);
  });

  it("a crashed worker fails its job and is replaced for the next one", async () => {
    const { pool, workers } = setup(1);
    const a = settled(pool.run(job("a")));
    void pool.run(job("b"));
    workers[0].crash();
    await flush();
    expect((a.error as Error).message).toBe(STRETCH_JOB_ERROR);
    expect(workers[0].terminated).toBe(true);
    expect(workers[1].posted.map((message) => message.jobId)).toEqual(["b"]);
  });

  it("dispose rejects everything and refuses new jobs", async () => {
    const { pool, workers } = setup(1);
    const a = settled(pool.run(job("a")));
    const b = settled(pool.run(job("b")));
    pool.dispose();
    await flush();
    expect(a.error).toBeInstanceOf(StretchCancelledError);
    expect(b.error).toBeInstanceOf(StretchCancelledError);
    expect(workers[0].terminated).toBe(true);
    await expect(pool.run(job("c"))).rejects.toBeInstanceOf(StretchCancelledError);
    expect(workers).toHaveLength(1);
  });
});
