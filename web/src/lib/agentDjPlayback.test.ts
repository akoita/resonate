import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "./api";

const getTrack = vi.fn();
vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, getTrack: (...args: unknown[]) => getTrack(...args) };
});

import { resolveDjQueue } from "./agentDjPlayback";

function catalogTrack(id: string, releaseId: string | null = "rel-1"): Track {
  return {
    id,
    title: `Title ${id}`,
    releaseId,
    createdAt: "2026-10-01T00:00:00.000Z",
    release: releaseId ? { id: releaseId } : undefined,
    stems: [],
  } as unknown as Track;
}

describe("resolveDjQueue", () => {
  beforeEach(() => {
    getTrack.mockReset();
  });

  it("returns playable tracks in pick order", async () => {
    getTrack.mockImplementation(async (id: string) => catalogTrack(id));
    const queue = await resolveDjQueue(["b", "a"], "tok");
    expect(queue.map((t) => t.id)).toEqual(["b", "a"]);
    expect(queue.every((t) => Boolean(t.remoteUrl))).toBe(true);
    expect(getTrack).toHaveBeenCalledWith("b", "tok");
  });

  it("dedupes ids, keeping the first occurrence", async () => {
    getTrack.mockImplementation(async (id: string) => catalogTrack(id));
    const queue = await resolveDjQueue(["a", "b", "a", "", "b"], "tok");
    expect(queue.map((t) => t.id)).toEqual(["a", "b"]);
    expect(getTrack).toHaveBeenCalledTimes(2);
  });

  it("skips tracks that fail to load or have no stream URL", async () => {
    getTrack.mockImplementation(async (id: string) => {
      if (id === "boom") throw new Error("404");
      if (id === "missing") return null;
      if (id === "no-release") return catalogTrack(id, null);
      return catalogTrack(id);
    });
    const queue = await resolveDjQueue(["boom", "ok-1", "missing", "no-release", "ok-2"], null);
    expect(queue.map((t) => t.id)).toEqual(["ok-1", "ok-2"]);
  });

  it("returns an empty queue for no ids", async () => {
    expect(await resolveDjQueue([], "tok")).toEqual([]);
    expect(getTrack).not.toHaveBeenCalled();
  });
});
