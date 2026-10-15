/**
 * #2146 — the shared notices store behind the bell and the shell banner.
 * Rendered statically (the suite has no DOM).
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  getPlatformNotices: vi.fn(),
  markPlatformNoticeRead: vi.fn(),
}));

import { getPlatformNotices, markPlatformNoticeRead, type PlatformNotice } from "./api";
import {
  getPlatformNoticesState,
  loadPlatformNotices,
  readPlatformNotice,
  resetPlatformNotices,
  selectBannerNotice,
} from "./platformNotices";
import { PlatformNoticeBannerView } from "../components/notifications/PlatformNoticeBanner";
import PlatformNoticeItems from "../components/notifications/PlatformNoticeItems";

const policy: PlatformNotice = {
  id: "n-policy",
  kind: "broadcast",
  category: "policy",
  title: "We updated our privacy policy",
  body: "Here is what changed.",
  link: "/privacy",
  effectiveAt: "2026-11-01T00:00:00.000Z",
  createdAt: "2026-10-15T10:00:00.000Z",
  readAt: null,
};
const moderation: PlatformNotice = {
  ...policy,
  id: "n-mod",
  kind: "targeted",
  category: "moderation",
  title: "Your community message was removed",
  body: "Reason: community guidelines.",
  link: "/help/platform-notices",
  effectiveAt: null,
};

afterEach(() => {
  resetPlatformNotices();
  vi.mocked(getPlatformNotices).mockReset();
  vi.mocked(markPlatformNoticeRead).mockReset();
});

describe("platform notice banner (#2146)", () => {
  it("shows an unread policy broadcast and hides it once dismissed", async () => {
    vi.mocked(getPlatformNotices).mockResolvedValue({ notices: [moderation, policy], unreadCount: 2 });
    vi.mocked(markPlatformNoticeRead).mockResolvedValue({ id: policy.id, readAt: "2026-10-15T11:00:00.000Z" });

    await loadPlatformNotices("token-1");
    const banner = selectBannerNotice(getPlatformNoticesState().notices);
    // A targeted moderation notice never raises the banner; the policy broadcast does.
    expect(banner?.id).toBe(policy.id);

    const html = renderToStaticMarkup(
      <PlatformNoticeBannerView notice={banner!} dismissing={false} onDismiss={() => {}} />,
    );
    expect(html).toContain("We updated our privacy policy");
    expect(html).toContain("Policy");
    expect(html).toContain("Takes effect");
    expect(html).toContain("Dismiss");
    expect(html).toContain('href="/privacy"');

    await readPlatformNotice("token-1", policy.id);
    expect(markPlatformNoticeRead).toHaveBeenCalledWith("token-1", policy.id);
    expect(selectBannerNotice(getPlatformNoticesState().notices)).toBeNull();
    expect(getPlatformNoticesState().unreadCount).toBe(1);
  });

  it("brings the banner back if the dismiss request fails", async () => {
    vi.mocked(getPlatformNotices).mockResolvedValue({ notices: [policy], unreadCount: 1 });
    vi.mocked(markPlatformNoticeRead).mockRejectedValue(new Error("offline"));
    await loadPlatformNotices("token-1");
    await expect(readPlatformNotice("token-1", policy.id)).rejects.toThrow("offline");
    expect(selectBannerNotice(getPlatformNoticesState().notices)?.id).toBe(policy.id);
  });

  it("shows nothing when signed out", async () => {
    await loadPlatformNotices(null);
    expect(getPlatformNotices).not.toHaveBeenCalled();
    expect(getPlatformNoticesState().notices).toEqual([]);
  });
});

describe("platform notices in the bell (#2146)", () => {
  it("lists each notice with its category", () => {
    const html = renderToStaticMarkup(
      <PlatformNoticeItems notices={[moderation, { ...policy, readAt: "2026-10-15T11:00:00.000Z" }]} onSelect={() => {}} />,
    );
    expect(html).toContain("Moderation");
    expect(html).toContain("Your community message was removed");
    expect(html).toContain("Reason: community guidelines.");
    expect(html).toContain("Policy");
    expect(html).toContain("We updated our privacy policy");
    // Only the unread notice carries the unread marker.
    expect(html.match(/aria-label="Unread"/g)).toHaveLength(1);
  });
});
