import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DJ_SEED_EVENT, djSeedChipLabel, parseDjSeed, queueDjSeed, takeDjSeed } from "./djSeed";

function stubBrowser() {
  const store = new Map<string, string>();
  const listeners: Array<() => void> = [];
  vi.stubGlobal("window", {
    sessionStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
    dispatchEvent: (event: Event) => {
      if (event.type === DJ_SEED_EVENT) listeners.forEach((listener) => listener());
      return true;
    },
  });
  return { store, listeners };
}

describe("djSeed (#2244)", () => {
  beforeEach(() => {
    vi.stubGlobal("Event", class FakeEvent { constructor(public type: string) {} });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("accepts a known kind with an id and bounds the label", () => {
    expect(parseDjSeed({ kind: "playlist", id: " p1 ", label: "  Late night " })).toEqual({
      kind: "playlist",
      id: "p1",
      label: "Late night",
    });
    expect(parseDjSeed({ kind: "track", id: "t1", label: "x".repeat(300) })?.label).toHaveLength(120);
    expect(parseDjSeed({ kind: "artist", id: "a1" })?.label).toBe("artist");
  });

  it.each([null, "x", [], { kind: "album", id: "x" }, { kind: "track" }, { kind: "track", id: "" }, { kind: "track", id: "i".repeat(101) }])(
    "rejects %j",
    (value) => expect(parseDjSeed(value)).toBeNull(),
  );

  it("queues a seed once, tells a mounted panel, and forgets it after it is taken", () => {
    const { listeners, store } = stubBrowser();
    const heard = vi.fn();
    listeners.push(heard);
    expect(queueDjSeed({ kind: "track", id: "t1", label: "A song" })).toBe(true);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(store.size).toBe(1);
    expect(takeDjSeed()).toEqual({ kind: "track", id: "t1", label: "A song" });
    expect(takeDjSeed()).toBeNull();
  });

  it("refuses a malformed seed and survives corrupt storage", () => {
    const { store } = stubBrowser();
    expect(queueDjSeed({ kind: "bogus", id: "x", label: "y" } as never)).toBe(false);
    store.set("resonate:dj-seed", "{not json");
    expect(takeDjSeed()).toBeNull();
  });

  it("does nothing without a browser", () => {
    expect(queueDjSeed({ kind: "track", id: "t1", label: "A" })).toBe(false);
    expect(takeDjSeed()).toBeNull();
  });

  it("labels the chip", () => {
    expect(djSeedChipLabel({ label: "Late night" })).toBe("From: Late night");
  });
});
