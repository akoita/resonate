"use client";

import { useEffect } from "react";
import { useAuth } from "../auth/AuthProvider";
import { recordRecentView, type RecentView } from "../../lib/recentViews";

/**
 * Remembers, in this browser only, that the signed-in listener opened a page,
 * for Home's "Jump back in" (#2735). Renders nothing. Pass `null` while the
 * page's data is loading or when the page should not be remembered (a draft,
 * an unpublished release).
 */
export function useRecordRecentView(view: Omit<RecentView, "viewedAt"> | null): void {
  const { status, userId } = useAuth();
  const signedIn = status === "authenticated" && Boolean(userId);
  // Re-record only when the page itself changes, not on every render.
  const key = view ? `${view.kind}:${view.id}:${view.title}:${view.imageUrl ?? ""}` : null;
  useEffect(() => {
    if (!signedIn || !view) return;
    recordRecentView(userId, view);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` captures the view's identity
  }, [signedIn, userId, key]);
}

export function RecordRecentView({ view }: { view: Omit<RecentView, "viewedAt"> | null }) {
  useRecordRecentView(view);
  return null;
}
