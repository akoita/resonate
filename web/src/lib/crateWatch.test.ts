import { describe, expect, it } from "vitest";
import {
  formatWatchDate,
  watchAvailability,
  watchMatchHref,
  watchMatchLabel,
  watchNotifiedNote,
  watchStatusText,
  watchSummaryText,
} from "./crateWatch";
import type { CrateWatch } from "./crates";

const allowed = { allowed: true, reason: "free_for_everyone", policyVersion: "v1" };
const denied = { allowed: false, reason: "subscription_required", policyVersion: "v2" };

function watch(overrides: Partial<CrateWatch> = {}): CrateWatch {
  return {
    mode: "off",
    expiresAt: null,
    summary: { month: "2026-10", matches: 0, notified: 0 },
    recentMatches: [],
    ...overrides,
  };
}

describe("crate watch rules", () => {
  it("formats the expiry in UTC", () => {
    expect(formatWatchDate("2026-12-31T23:30:00.000Z")).toBe("Dec 31, 2026");
    expect(formatWatchDate(null)).toBeNull();
    expect(formatWatchDate("nope")).toBeNull();
  });

  it("asks to save a draft, and reads the entitlement from the server", () => {
    expect(watchAvailability({ status: "draft", watchEntitlement: allowed })).toBe("draft");
    expect(watchAvailability({ status: "saved", watchEntitlement: allowed })).toBe("available");
    expect(watchAvailability({ status: "saved", watchEntitlement: denied })).toBe("denied");
    // Never guess a permission that was not sent.
    expect(watchAvailability({ status: "saved", watchEntitlement: undefined })).toBe("denied");
  });

  it("says what is happening now", () => {
    expect(watchStatusText(watch({ mode: "notify", expiresAt: "2026-12-31T12:00:00.000Z" }))).toBe(
      "Watching until Dec 31, 2026",
    );
    expect(watchStatusText(watch({ mode: "off", expiresAt: "2026-09-01T12:00:00.000Z" }))).toBe(
      "Watching ended Sep 1, 2026",
    );
    expect(watchStatusText(watch())).toBe("Not watching");
  });

  it("summarises the month", () => {
    const summary = (matches: number, notified: number) => ({ month: "2026-10", matches, notified });
    expect(watchSummaryText(summary(3, 3))).toBe("3 new matches this month");
    expect(watchSummaryText(summary(1, 1))).toBe("1 new match this month");
    expect(watchSummaryText(summary(0, 0))).toBe("No new matches this month yet");
    expect(watchNotifiedNote(summary(3, 3))).toBeNull();
    expect(watchNotifiedNote(summary(3, 2))).toContain("2 of 3 sent a notification");
  });

  it("labels and links a match", () => {
    expect(watchMatchLabel({ title: "Night Drive", artistName: "Ada" })).toBe("Night Drive by Ada");
    expect(watchMatchLabel({ title: "Night Drive", artistName: null })).toBe("Night Drive");
    expect(watchMatchHref({ releaseId: "r 1" })).toBe("/release/r%201");
    expect(watchMatchHref({ releaseId: null })).toBeNull();
  });
});
