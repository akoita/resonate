import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearRecent,
  normalizeRecentView,
  readRecentClearedAt,
  readRecentViews,
  recordRecentView,
  removeAllRecentViews,
  RECENT_VIEWS_CAP,
  RECENT_VIEWS_CHANGED_EVENT,
  RECENT_VIEWS_STORAGE_PREFIX,
} from "./recentViews";

function memoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    key: (index: number) => [...store.keys()][index] ?? null,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  };
}

let events: string[] = [];

beforeEach(() => {
  events = [];
  vi.stubGlobal("window", {
    localStorage: memoryStorage(),
    dispatchEvent: (event: Event) => {
      events.push(event.type);
      return true;
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const artist = { kind: "artist" as const, id: "a1", title: "Aya", href: "/artist/a1", artistId: "a1" };

describe("recentViews", () => {
  it("keeps one entry per page, newest first, per account", () => {
    recordRecentView("u1", { ...artist, viewedAt: 1 });
    recordRecentView("u1", { kind: "show", id: "s1", title: "Paris", href: "/shows/s1", viewedAt: 2 });
    recordRecentView("u1", { ...artist, viewedAt: 3 });
    expect(readRecentViews("u1").map((view) => `${view.kind}:${view.id}`)).toEqual(["artist:a1", "show:s1"]);
    expect(readRecentViews("u2")).toEqual([]);
    expect(events).toContain(RECENT_VIEWS_CHANGED_EVENT);
  });

  it("does nothing without an account", () => {
    recordRecentView(null, artist);
    expect(window.localStorage.length).toBe(0);
  });

  it("caps the list", () => {
    for (let index = 0; index < RECENT_VIEWS_CAP + 5; index += 1) {
      recordRecentView("u1", { kind: "show", id: `s${index}`, title: `Show ${index}`, href: `/shows/s${index}`, viewedAt: index });
    }
    const views = readRecentViews("u1");
    expect(views).toHaveLength(RECENT_VIEWS_CAP);
    expect(views[0].id).toBe(`s${RECENT_VIEWS_CAP + 4}`);
  });

  it("drops entries with an off-site link or an unsafe image", () => {
    expect(normalizeRecentView({ ...artist, href: "https://evil.example/x", viewedAt: 1 })).toBeNull();
    expect(normalizeRecentView({ ...artist, href: "//evil.example/x", viewedAt: 1 })).toBeNull();
    expect(normalizeRecentView({ ...artist, viewedAt: 1, imageUrl: "javascript:alert(1)" })?.imageUrl).toBeUndefined();
    expect(normalizeRecentView({ ...artist, kind: "device_file", viewedAt: 1 })).toBeNull();
    window.localStorage.setItem(RECENT_VIEWS_STORAGE_PREFIX + "u1", "not json");
    expect(readRecentViews("u1")).toEqual([]);
  });

  it("clears the list and remembers when", () => {
    recordRecentView("u1", artist);
    clearRecent("u1", 1234);
    expect(readRecentViews("u1")).toEqual([]);
    expect(readRecentClearedAt("u1")).toBe(1234);
  });

  it("removes every account's list on a full local reset", () => {
    recordRecentView("u1", artist);
    recordRecentView("u2", artist);
    clearRecent("u2", 5);
    window.localStorage.setItem("resonate.token", "keep");
    // u1's list and u2's clear marker (clearing already emptied u2's list).
    expect(removeAllRecentViews()).toHaveLength(2);
    expect(window.localStorage.length).toBe(1);
  });
});
