"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { getManagedShowCampaign, type Campaign } from "../../lib/shows";

export type CampaignManageAccess = "checking" | "signed-out" | "allowed" | "denied";

type AuthStatus = ReturnType<typeof useAuth>["status"];

/**
 * The answer that needs no request, or null when the managed read must decide.
 * A disabled check is "denied" so callers never fire the request (or render an
 * owner action) for surfaces where it can't apply.
 */
export function campaignManageAccessWithoutFetch(input: {
  enabled: boolean;
  status: AuthStatus;
  token: string | null;
}): CampaignManageAccess | null {
  if (!input.enabled) return "denied";
  if (input.status === "loading") return "checking";
  if (input.status !== "authenticated" || !input.token) return "signed-out";
  return null;
}

/** Asks the backend whether this token may manage the campaign. */
export async function resolveCampaignManageAccess(input: {
  campaignId: string;
  token: string;
}): Promise<CampaignManageAccess> {
  try {
    const managed = await getManagedShowCampaign(input);
    return managed ? "allowed" : "denied";
  } catch {
    return "denied";
  }
}

/**
 * Whether the signed-in viewer may manage (edit) a campaign. There is no
 * `artist` JWT role (#2128): the artist owner, admins, and operators are
 * exactly the callers the backend's managed read
 * (GET /shows/campaigns/:id/manage) answers, so its success is the signal.
 */
export function useCampaignManageAccess(
  campaign: Pick<Campaign, "backendId" | "rawStatus">,
  options: { enabled?: boolean } = {},
): CampaignManageAccess {
  const { status, token } = useAuth();
  const enabled = options.enabled ?? true;
  const backendId = campaign.backendId;
  const immediate = campaignManageAccessWithoutFetch({ enabled, status, token });
  // Results are keyed by campaign + token so a stale answer never leaks across
  // a sign-out, account switch, or client-side navigation.
  const key = `${backendId}\u0000${token ?? ""}`;
  const [resolved, setResolved] = useState<{ key: string; access: CampaignManageAccess } | null>(null);

  useEffect(() => {
    if (immediate !== null || !token) return;
    let cancelled = false;
    void resolveCampaignManageAccess({ campaignId: backendId, token }).then((access) => {
      if (!cancelled) setResolved({ key, access });
    });
    return () => {
      cancelled = true;
    };
  }, [immediate, token, backendId, key]);

  if (immediate !== null) return immediate;
  return resolved?.key === key ? resolved.access : "checking";
}
