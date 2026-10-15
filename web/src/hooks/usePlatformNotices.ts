"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../components/auth/AuthProvider";
import {
  getPlatformNoticesState,
  loadPlatformNotices,
  readPlatformNotice,
  resetPlatformNotices,
  subscribeToPlatformNotices,
  type PlatformNoticesState,
} from "../lib/platformNotices";
import { registerManagementInvitationRefresh } from "./useManagementInvitations";

/**
 * #2146: the signed-in person's platform notices, shared by the bell and the
 * shell banner. Exactly one mounted reader should pass `poll: true` (the shell
 * banner); it loads on sign-in, refreshes while the tab is visible, and clears
 * on sign-out. Signed-out visitors get an empty list and no requests.
 */
export function usePlatformNotices(options: { poll?: boolean } = {}) {
  const { status, token } = useAuth();
  const signedIn = status === "authenticated" && Boolean(token);
  const [snapshot, setSnapshot] = useState<PlatformNoticesState>(() => getPlatformNoticesState());

  useEffect(() => subscribeToPlatformNotices(setSnapshot), []);

  useEffect(() => {
    if (!options.poll) return;
    if (!signedIn || !token) {
      resetPlatformNotices();
      return;
    }
    return registerManagementInvitationRefresh(async () => {
      await loadPlatformNotices(token);
    }, document);
  }, [options.poll, signedIn, token]);

  const refetch = useCallback(() => (token ? loadPlatformNotices(token) : Promise.resolve(getPlatformNoticesState())), [token]);
  const markRead = useCallback(
    async (noticeId: string) => {
      if (!token) return;
      await readPlatformNotice(token, noticeId);
    },
    [token],
  );

  // Never show a previous session's notices to the current one.
  const current = signedIn && snapshot.token === token ? snapshot : { token: null, notices: [], unreadCount: 0 };
  return { notices: current.notices, unreadCount: current.unreadCount, refetch, markRead };
}
