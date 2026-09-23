"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getPendingManagementInvitations,
  type ManagementScope,
  type PendingManagementInvitations,
} from "../lib/api";

export const MANAGEMENT_INVITATIONS_POLL_INTERVAL_MS = 45_000;

const EMPTY_INVITATIONS: PendingManagementInvitations = { grants: [], transfers: [] };

export type ManagementInvitationItem = {
  id: string;
  kind: "grant" | "transfer";
  title: string;
  message: string;
  expiresAt: string | null;
};

export function registerManagementInvitationRefresh(
  refetch: () => void | Promise<void>,
  visibilityTarget: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">,
  intervalMs = MANAGEMENT_INVITATIONS_POLL_INTERVAL_MS,
) {
  let active = true;
  let requestActive = false;
  const refresh = () => {
    if (!active || requestActive || visibilityTarget.visibilityState !== "visible") return;
    requestActive = true;
    void Promise.resolve(refetch())
      .catch(() => undefined)
      .finally(() => { requestActive = false; });
  };
  const onVisibilityChange = () => {
    if (visibilityTarget.visibilityState === "visible") refresh();
  };

  refresh();
  const intervalId = setInterval(refresh, intervalMs);
  visibilityTarget.addEventListener("visibilitychange", onVisibilityChange);

  return () => {
    active = false;
    clearInterval(intervalId);
    visibilityTarget.removeEventListener("visibilitychange", onVisibilityChange);
  };
}

const managementScopeLabels: Record<ManagementScope, string> = {
  PROFILE_EDIT: "edit the artist profile",
  CATALOG_READ: "view the catalog",
  CATALOG_METADATA: "edit catalog details",
  CATALOG_MEDIA: "manage artwork and media",
  TRACK_METADATA: "edit track details",
  TRACK_AUDIO: "replace track audio",
};

export function toManagementInvitationItems(
  invitations: PendingManagementInvitations,
): ManagementInvitationItem[] {
  const grants = invitations.grants.map((grant) => {
    const requestedAccess = grant.scopes.map((scope) => managementScopeLabels[scope]).join(", ");
    return {
      id: `management-grant-${grant.id}`,
      kind: "grant" as const,
      title: "Management invitation",
      message: requestedAccess
        ? `You were invited to manage ${grant.resourceName}. Requested access: ${requestedAccess}.`
        : `You were invited to manage ${grant.resourceName}. Review the requested access.`,
      expiresAt: grant.expiresAt,
    };
  });

  const transfers = invitations.transfers.map((transfer) => {
    const resourceNames = transfer.resources.map((resource) => resource.name).filter(Boolean);
    const resourceSummary = resourceNames.length > 0
      ? resourceNames.join(", ")
      : transfer.resourceType === "artist_profile" ? "the artist profile" : "the selected releases";
    return {
      id: `management-transfer-${transfer.id}`,
      kind: "transfer" as const,
      title: "Management transfer invitation",
      message: `Review the proposed management transfer for ${resourceSummary}.`,
      expiresAt: transfer.expiresAt,
    };
  });

  return [...grants, ...transfers];
}

/** Reads invitations using the authenticated management endpoint, never the public wallet feed. */
export function useManagementInvitations(token?: string | null, userId?: string | null) {
  // Keep credentials out of the snapshot key while ensuring either auth change
  // produces an empty render until that session's invitations have been fetched.
  const sessionScope = useMemo(
    () => token ? Symbol(userId ? "management-invitations-user" : "management-invitations-user-unknown") : null,
    [token, userId],
  );
  const requestSequenceRef = useRef(0);
  const [snapshot, setSnapshot] = useState<{
    sessionScope: symbol | null;
    invitations: PendingManagementInvitations;
  }>({ sessionScope: null, invitations: EMPTY_INVITATIONS });

  const refetch = useCallback(async () => {
    if (!token || !sessionScope) return;

    const requestSequence = ++requestSequenceRef.current;
    try {
      const invitations = await getPendingManagementInvitations(token);
      if (requestSequenceRef.current === requestSequence) {
        setSnapshot({ sessionScope, invitations });
      }
    } catch {
      // Keep the last result for this session; the next poll, open, or visibility
      // change will retry without surfacing a transient private-feed error.
    }
  }, [sessionScope, token]);

  useEffect(() => {
    requestSequenceRef.current += 1;
    if (!token || !sessionScope) {
      setSnapshot({ sessionScope: null, invitations: EMPTY_INVITATIONS });
      return;
    }

    setSnapshot({ sessionScope, invitations: EMPTY_INVITATIONS });
    const cleanupRefresh = registerManagementInvitationRefresh(refetch, document);
    return () => {
      cleanupRefresh();
      requestSequenceRef.current += 1;
    };
  }, [refetch, sessionScope, token]);

  return {
    invitations: snapshot.sessionScope === sessionScope && sessionScope
      ? snapshot.invitations
      : EMPTY_INVITATIONS,
    refetch,
  };
}
