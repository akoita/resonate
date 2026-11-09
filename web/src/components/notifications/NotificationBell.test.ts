import { describe, expect, it } from "vitest";
import type { DisputeNotification } from "../../hooks/useDisputeNotifications";
import { getNotificationActionHint, getNotificationHref } from "./NotificationBell";

function notification(type: string, extra: Partial<DisputeNotification> = {}): DisputeNotification {
  return { id: "n-1", type, title: "t", message: "m", read: false, createdAt: "2026-09-24T10:00:00.000Z", ...extra };
}

describe("notification routing", () => {
  it("sends operators from a credit request to the credit-request queue", () => {
    for (const role of ["operator", "admin"]) {
      expect(getNotificationHref(notification("credits_requested"), role)).toBe("/admin/credit-requests");
      expect(getNotificationActionHint(notification("credits_requested"), role)).toBe("Review credit requests →");
    }
  });

  it("sends a requester whose credits were granted back to Create", () => {
    expect(getNotificationHref(notification("credits_granted"), "user")).toBe("/create");
    expect(getNotificationActionHint(notification("credits_granted"), "user")).toBe("Start creating →");
  });

  it("sends a remix source hold, and its end, to the remix release (#2601)", () => {
    expect(getNotificationHref(notification("remix_source_hold", { releaseId: "r-1" }), "user")).toBe("/release/r-1");
    expect(getNotificationHref(notification("remix_source_hold_lifted", { releaseId: "r-1" }), "user"))
      .toBe("/release/r-1");
    expect(getNotificationHref(notification("remix_source_hold"), "user")).toBe("/artist/catalog");
    expect(getNotificationActionHint(notification("remix_source_hold"), "user")).toBe("Open your remix →");
  });

  it("sends a removed remix draft notice to the library (#2600)", () => {
    expect(getNotificationHref(notification("remix_draft_removed"), "user")).toBe("/library");
    expect(getNotificationActionHint(notification("remix_draft_removed"), "user")).toBe("Open your library →");
  });

  it("sends a crate watch match to its crate, or to the crate list without one (#1967)", () => {
    expect(getNotificationHref(notification("crate_watch_match", { crateId: "c 1" }), "user"))
      .toBe("/crates/c%201");
    expect(getNotificationHref(notification("crate_watch_match"), "user")).toBe("/crates");
    expect(getNotificationHref(notification("crate_watch_match", { crateId: null }), "user")).toBe("/crates");
    expect(getNotificationActionHint(notification("crate_watch_match"), "user")).toBe("Open crate →");
  });

  it("keeps the existing listing, release-rights, and dispute mappings", () => {
    expect(getNotificationHref(notification("listing_expired", { stemListingId: "l-1" }), null))
      .toBe("/artist/listings?listing=l-1&status=expired");
    expect(getNotificationActionHint(notification("listing_expiring_soon"), null)).toBe("Open listing manager →");
    expect(getNotificationHref(notification("release_rights_submitted"), "admin")).toBe("/disputes/admin");
    expect(getNotificationActionHint(notification("release_rights_submitted"), "admin")).toBe("Open admin review →");
    expect(getNotificationHref(notification("release_rights_denied", { releaseId: "r-1" }), "user")).toBe("/release/r-1");
    expect(getNotificationActionHint(notification("release_rights_denied"), "user")).toBe("Open release →");
    expect(getNotificationHref(notification("dispute_filed", { disputeId: "d-1" }), null)).toBe("/disputes?tab=creator&dispute=d-1");
    expect(getNotificationHref(notification("dispute_resolved"), null)).toBe("/disputes");
    expect(getNotificationActionHint(notification("dispute_resolved"), null)).toBe("View in dispute center →");
  });
});
