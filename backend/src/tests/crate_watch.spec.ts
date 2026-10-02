/**
 * Crate watching, the pure core (#1967) — unit tests. Watching only notifies,
 * `auto_buy` is reserved and refused, and a track matches only when it fails no
 * filter.
 */
import {
  CRATE_WATCH_DEFAULT_DAYS,
  CRATE_WATCH_DTO_MODES,
  CRATE_WATCH_MAX_CRATES_PER_EVENT,
  CRATE_WATCH_NOTIFICATIONS_PER_DAY,
  CRATE_WATCH_NOTIFICATION_WINDOW_MS,
  CRATE_WATCH_RECENT_MATCHES_LIMIT,
  evaluateWatchMatch,
  isWatching,
  monthBounds,
  monthKey,
  notificationWindowStart,
  notificationsRemaining,
  parseWatchRequest,
  watchExpiresAt,
  watchNotificationCopy,
} from "../modules/crates/crate_watch";
import { defaultCrateFilters } from "../modules/crates/crate_filters";
import type { CrateCandidateFacts, CrateFilters } from "../modules/crates/crate.types";

function facts(overrides: Partial<CrateCandidateFacts> = {}): CrateCandidateFacts {
  return {
    trackId: "track-new",
    artistId: "artist-1",
    genre: "House",
    moods: ["Club"],
    aiDisclosureLevel: "NONE",
    tempoBpm: 124,
    camelot: "8A",
    energy: 0.7,
    stemTypes: ["vocals", "drums"],
    listedLicenseTypes: ["personal"],
    indicativePriceUsd: { personal: 2 },
    verifiedHuman: false,
    ...overrides,
  };
}

function filters(overrides: Partial<CrateFilters> = {}): CrateFilters {
  return { ...defaultCrateFilters(), ...overrides };
}

const base = {
  crateTrackIds: new Set<string>(["track-old"]),
  crateUserId: "dj-1",
  artistUserId: "artist-user-1",
};

describe("parseWatchRequest", () => {
  it("accepts off and notify, defaulting the expiry to 90 days", () => {
    expect(CRATE_WATCH_DEFAULT_DAYS).toBe(90);
    expect(parseWatchRequest({ mode: "notify" })).toEqual({
      ok: true,
      mode: "notify",
      expiresInDays: 90,
    });
    expect(parseWatchRequest({ mode: "off" })).toEqual({ ok: true, mode: "off", expiresInDays: 90 });
    expect(parseWatchRequest({ mode: "notify", expiresInDays: null })).toMatchObject({
      expiresInDays: 90,
    });
  });

  it("accepts a whole number of days from 1 to 365", () => {
    for (const days of [1, 30, 365]) {
      expect(parseWatchRequest({ mode: "notify", expiresInDays: days })).toEqual({
        ok: true,
        mode: "notify",
        expiresInDays: days,
      });
    }
  });

  it.each([0, -1, 366, 1.5, NaN, Infinity, "30", true, {}])(
    "refuses an expiry of %p with invalid_watch_expiry",
    (days) => {
      expect(parseWatchRequest({ mode: "notify", expiresInDays: days })).toEqual({
        ok: false,
        code: "invalid_watch_expiry",
      });
    },
  );

  it("reserves auto_buy: it is a known name and is refused with its own code", () => {
    expect(CRATE_WATCH_DTO_MODES).toContain("auto_buy");
    expect(parseWatchRequest({ mode: "auto_buy" })).toEqual({
      ok: false,
      code: "watch_mode_unavailable",
    });
    expect(parseWatchRequest({ mode: "auto_buy", expiresInDays: 30 })).toEqual({
      ok: false,
      code: "watch_mode_unavailable",
    });
  });

  it.each([undefined, null, "", "NOTIFY", "email", 1, true])(
    "refuses the mode %p with invalid_watch_mode",
    (mode) => {
      expect(parseWatchRequest({ mode })).toEqual({ ok: false, code: "invalid_watch_mode" });
    },
  );

  it.each([undefined, null, "notify", 5, []])("refuses the body %p with invalid_watch", (body) => {
    expect(parseWatchRequest(body)).toEqual({ ok: false, code: "invalid_watch" });
  });
});

describe("watchExpiresAt and isWatching", () => {
  const now = new Date("2026-10-02T12:00:00.000Z");

  it("ends whole days after now", () => {
    expect(watchExpiresAt(now, 90).toISOString()).toBe("2026-12-31T12:00:00.000Z");
    expect(watchExpiresAt(now, 1).toISOString()).toBe("2026-10-03T12:00:00.000Z");
  });

  it("watches only in notify mode with a future expiry", () => {
    const future = new Date("2026-10-03T00:00:00.000Z");
    const past = new Date("2026-10-01T00:00:00.000Z");
    expect(isWatching({ watchMode: "notify", watchExpiresAt: future }, now)).toBe(true);
    expect(isWatching({ watchMode: "notify", watchExpiresAt: past }, now)).toBe(false);
    expect(isWatching({ watchMode: "notify", watchExpiresAt: now }, now)).toBe(false);
    expect(isWatching({ watchMode: "notify", watchExpiresAt: null }, now)).toBe(false);
    expect(isWatching({ watchMode: "off", watchExpiresAt: future }, now)).toBe(false);
    // The reserved mode is never treated as watching.
    expect(isWatching({ watchMode: "auto_buy", watchExpiresAt: future }, now)).toBe(false);
  });
});

describe("evaluateWatchMatch", () => {
  it("matches a track that fails no filter, with open filters too", () => {
    expect(evaluateWatchMatch({ ...base, facts: facts(), filters: filters() })).toBe("match");
    expect(
      evaluateWatchMatch({
        ...base,
        facts: facts(),
        filters: filters({ bpm: { min: 122, max: 126 }, genres: ["house"] }),
      }),
    ).toBe("match");
  });

  it("does not match a track that fails any filter", () => {
    expect(
      evaluateWatchMatch({
        ...base,
        facts: facts({ tempoBpm: 140 }),
        filters: filters({ bpm: { min: 122, max: 126 } }),
      }),
    ).toBe("filters");
  });

  it("never lets an unknown fact satisfy a filter", () => {
    expect(
      evaluateWatchMatch({
        ...base,
        facts: facts({ tempoBpm: null }),
        filters: filters({ bpm: { min: 122, max: 126 } }),
      }),
    ).toBe("filters");
    expect(
      evaluateWatchMatch({
        ...base,
        facts: facts({ indicativePriceUsd: {} }),
        filters: filters({ maxPerItemUsd: 5 }),
      }),
    ).toBe("filters");
  });

  it("ignores the crate-level count and total budget for a single track", () => {
    expect(
      evaluateWatchMatch({
        ...base,
        facts: facts({ indicativePriceUsd: { personal: 50 } }),
        filters: filters({ count: 1, maxTotalUsd: 1 }),
      }),
    ).toBe("match");
  });

  it("skips the crate owner's own release", () => {
    expect(
      evaluateWatchMatch({
        ...base,
        crateUserId: "artist-user-1",
        facts: facts(),
        filters: filters(),
      }),
    ).toBe("own_track");
    // An artist without an account is nobody's own track.
    expect(
      evaluateWatchMatch({ ...base, artistUserId: null, facts: facts(), filters: filters() }),
    ).toBe("match");
  });

  it("skips a track already in the crate", () => {
    expect(
      evaluateWatchMatch({
        ...base,
        crateTrackIds: new Set(["track-new"]),
        facts: facts(),
        filters: filters(),
      }),
    ).toBe("already_in_crate");
  });

  it("excludes fully AI recordings unless the crate allows them", () => {
    expect(
      evaluateWatchMatch({
        ...base,
        facts: facts({ aiDisclosureLevel: "ALL" }),
        filters: filters(),
      }),
    ).toBe("fully_ai");
    expect(
      evaluateWatchMatch({
        ...base,
        facts: facts({ aiDisclosureLevel: "all" }),
        filters: filters({ allowFullyAi: true }),
      }),
    ).toBe("match");
    // Partly AI is not fully AI.
    expect(
      evaluateWatchMatch({
        ...base,
        facts: facts({ aiDisclosureLevel: "PARTLY" }),
        filters: filters(),
      }),
    ).toBe("match");
  });

  it("is deterministic", () => {
    const input = { ...base, facts: facts(), filters: filters({ keys: ["8A"] }) };
    expect(evaluateWatchMatch(input)).toBe(evaluateWatchMatch(input));
  });
});

describe("notification budget", () => {
  it("allows 20 per rolling 24 hours", () => {
    expect(CRATE_WATCH_NOTIFICATIONS_PER_DAY).toBe(20);
    expect(CRATE_WATCH_NOTIFICATION_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
    expect(notificationsRemaining(0)).toBe(20);
    expect(notificationsRemaining(19)).toBe(1);
    expect(notificationsRemaining(20)).toBe(0);
    expect(notificationsRemaining(500)).toBe(0);
    expect(notificationsRemaining(-3)).toBe(20);
  });

  it("starts the window 24 hours before now", () => {
    const now = new Date("2026-10-02T12:00:00.000Z");
    expect(notificationWindowStart(now).toISOString()).toBe("2026-10-01T12:00:00.000Z");
  });

  it("exports the bounds", () => {
    expect(CRATE_WATCH_MAX_CRATES_PER_EVENT).toBe(500);
    expect(CRATE_WATCH_RECENT_MATCHES_LIMIT).toBe(20);
  });
});

describe("month summary helpers", () => {
  it("names the UTC month and bounds it", () => {
    const date = new Date("2026-12-31T23:59:59.000Z");
    expect(monthKey(date)).toBe("2026-12");
    expect(monthBounds(date).start.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(monthBounds(date).end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(monthKey(new Date("2026-02-01T00:00:00.000Z"))).toBe("2026-02");
  });
});

describe("watchNotificationCopy", () => {
  it("names the crate, the track and the artist", () => {
    expect(
      watchNotificationCopy({ crateTitle: "Friday", trackTitle: "Night Drive", artistName: "Ada" }),
    ).toEqual({
      title: "New match for Friday",
      message: "Night Drive by Ada fits your crate filters.",
    });
  });

  it("falls back for an untitled crate and an unknown artist", () => {
    expect(
      watchNotificationCopy({ crateTitle: null, trackTitle: "Night Drive", artistName: null }),
    ).toEqual({
      title: "New match for your crate",
      message: "Night Drive fits your crate filters.",
    });
    expect(
      watchNotificationCopy({ crateTitle: "  ", trackTitle: "X", artistName: " " }).title,
    ).toBe("New match for your crate");
  });
});
