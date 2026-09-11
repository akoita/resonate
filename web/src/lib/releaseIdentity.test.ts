import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveDeployedRelease } from "./releaseIdentity";

const SHA = "abc1234";
const FULL_SHA = "ABC1234def5678901234567890123456789012ab";

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

function notFound() {
  return { ok: false, status: 404, json: async () => ({}) };
}

function tagList(name: string, sha: string) {
  return [
    { name: "v0.9.0", commit: { sha: "9999999aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } },
    { name, commit: { sha } },
  ];
}

// A fresh in-memory store per test keeps the cache assertions honest.
function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

describe("resolveDeployedRelease", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the published release when a tag points at the commit", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/tags?")) return ok(tagList("milestone-21", FULL_SHA));
      return ok({
        html_url: "https://github.com/akoita/resonate/releases/tag/milestone-21",
      });
    });

    const result = await resolveDeployedRelease(SHA, {
      fetch: fetchMock,
      storage: memoryStorage(),
    });

    expect(result).toEqual({
      kind: "release",
      name: "milestone-21",
      url: "https://github.com/akoita/resonate/releases/tag/milestone-21",
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.github.com/repos/akoita/resonate/tags?per_page=100",
    );
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://api.github.com/repos/akoita/resonate/releases/tags/milestone-21",
    );
  });

  it("falls back to the tag tree page when no release exists", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.includes("/tags?") ? ok(tagList("v1.2.0", FULL_SHA)) : notFound(),
    );

    const result = await resolveDeployedRelease(SHA, {
      fetch: fetchMock,
      storage: memoryStorage(),
    });

    expect(result).toEqual({
      kind: "tag",
      name: "v1.2.0",
      url: "https://github.com/akoita/resonate/tree/v1.2.0",
    });
  });

  it("returns null when no tag points at the commit", async () => {
    const fetchMock = vi.fn(async () =>
      ok(tagList("v1.2.0", "0000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")),
    );

    const result = await resolveDeployedRelease(SHA, {
      fetch: fetchMock,
      storage: memoryStorage(),
    });

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns null when the tags request throws", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("offline");
    });

    await expect(
      resolveDeployedRelease(SHA, {
        fetch: fetchMock,
        storage: memoryStorage(),
      }),
    ).resolves.toBeNull();
  });

  it("returns null when the tags request is rate limited", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => ({ message: "API rate limit exceeded" }),
    }));

    const result = await resolveDeployedRelease(SHA, {
      fetch: fetchMock,
      storage: memoryStorage(),
    });

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns null on malformed JSON without throwing", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token <");
      },
    }));

    await expect(
      resolveDeployedRelease(SHA, {
        fetch: fetchMock,
        storage: memoryStorage(),
      }),
    ).resolves.toBeNull();
  });

  it("does not fetch at all for an empty SHA", async () => {
    const fetchMock = vi.fn(async () => ok([]));

    const result = await resolveDeployedRelease("", {
      fetch: fetchMock,
      storage: memoryStorage(),
    });

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("serves a repeated lookup from the cache", async () => {
    const storage = memoryStorage();
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/tags?")) return ok(tagList("milestone-21", FULL_SHA));
      return ok({
        html_url: "https://github.com/akoita/resonate/releases/tag/milestone-21",
      });
    });

    const first = await resolveDeployedRelease(SHA, {
      fetch: fetchMock,
      storage,
    });
    const second = await resolveDeployedRelease(SHA, {
      fetch: fetchMock,
      storage,
    });

    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("caches a negative result so a rate-limited viewer stops asking", async () => {
    const storage = memoryStorage();
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => ({}),
    }));

    await resolveDeployedRelease(SHA, { fetch: fetchMock, storage });
    const second = await resolveDeployedRelease(SHA, { fetch: fetchMock, storage });

    expect(second).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("survives a storage that throws on read and write", async () => {
    const hostileStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    const fetchMock = vi.fn(async (url: string) =>
      url.includes("/tags?") ? ok(tagList("v1.2.0", FULL_SHA)) : notFound(),
    );

    const result = await resolveDeployedRelease(SHA, {
      fetch: fetchMock,
      storage: hostileStorage,
    });

    expect(result?.name).toBe("v1.2.0");
  });
});
