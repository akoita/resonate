"use client";

import { useEffect, useState } from "react";
import { getArtistMe, getMyCommunityProfile } from "../lib/api";

/**
 * The name to show for the signed-in person: their artist name, else the name
 * on their community profile, else nothing (callers then say "Your account").
 *
 * Accounts are passkey-backed and the address behind them is an implementation
 * detail, so the shell never names a person by their address. The lookup is
 * shared by the top bar chip and the sidebar footer: one request pair per
 * session token, not one per component.
 */
const cache = new Map<string, Promise<string | null>>();

async function lookUp(token: string): Promise<string | null> {
  const artist = await getArtistMe(token).catch(() => null);
  const artistName = artist?.displayName?.trim();
  if (artistName) return artistName;
  const community = await getMyCommunityProfile(token).catch(() => null);
  const communityName = community?.profile?.displayName?.trim();
  return communityName || null;
}

export function accountNameFor(token: string): Promise<string | null> {
  let pending = cache.get(token);
  if (!pending) {
    pending = lookUp(token);
    cache.set(token, pending);
  }
  return pending;
}

export function useAccountName(token: string | null | undefined, enabled: boolean): string | null {
  const [name, setName] = useState<{ token: string; value: string | null } | null>(null);
  useEffect(() => {
    if (!enabled || !token) return;
    let cancelled = false;
    void accountNameFor(token).then((value) => {
      if (!cancelled) setName({ token, value });
    });
    return () => { cancelled = true; };
  }, [enabled, token]);
  return enabled && token && name?.token === token ? name.value : null;
}
