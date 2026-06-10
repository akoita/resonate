import { describe, expect, it } from "vitest";
import {
  formatListingCountdown,
  shortAddress,
  stemTypeTheme,
} from "./stemPageTheme";

describe("stemTypeTheme", () => {
  it("maps known types to their marketplace badge identities", () => {
    expect(stemTypeTheme("vocals").badgeClass).toBe("stem-type-badge--vocals");
    expect(stemTypeTheme("DRUMS").accentRgb).toBe("249, 115, 22");
    expect(stemTypeTheme("bass").emoji).toBe("🎸");
  });

  it("routes melodic instruments to the melody theme", () => {
    expect(stemTypeTheme("piano").badgeClass).toBe("stem-type-badge--melody");
    expect(stemTypeTheme("guitar").badgeClass).toBe("stem-type-badge--melody");
  });

  it("falls back to the other theme for unknown or missing types", () => {
    expect(stemTypeTheme("fx").badgeClass).toBe("stem-type-badge--other");
    expect(stemTypeTheme(null).badgeClass).toBe("stem-type-badge--other");
    expect(stemTypeTheme(undefined).accentRgb).toBe("16, 185, 129");
  });
});

describe("formatListingCountdown", () => {
  const now = new Date("2026-06-10T12:00:00Z");

  it("formats days, hours, and minutes", () => {
    expect(
      formatListingCountdown(new Date("2026-06-17T11:00:00Z"), now),
    ).toBe("6d 23h left");
    expect(
      formatListingCountdown(new Date("2026-06-10T15:30:00Z"), now),
    ).toBe("3h 30m left");
    expect(
      formatListingCountdown(new Date("2026-06-10T12:20:00Z"), now),
    ).toBe("20m left");
  });

  it("returns null for expired, missing, or invalid inputs", () => {
    expect(formatListingCountdown(new Date("2026-06-10T11:00:00Z"), now)).toBeNull();
    expect(formatListingCountdown(null, now)).toBeNull();
    expect(formatListingCountdown("not-a-date", now)).toBeNull();
  });
});

describe("shortAddress", () => {
  it("truncates long addresses and passes short values through", () => {
    expect(shortAddress("0xF6917C09aabbccddeeff00112233445278De998a")).toBe(
      "0xF691…998a",
    );
    expect(shortAddress("Creator")).toBe("Creator");
    expect(shortAddress(null)).toBe("");
  });
});
