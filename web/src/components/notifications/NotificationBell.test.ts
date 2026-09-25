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

  it("keeps the existing listing, release-rights, and dispute mappings", () => {
    expect(getNotificationHref(notification("listing_expired", { stemListingId: "l-1" }), null))
      .toBe("/marketplace/manage?listing=l-1&status=expired");
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
