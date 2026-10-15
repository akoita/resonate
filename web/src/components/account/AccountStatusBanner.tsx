"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../auth/AuthProvider";
import {
  describeAccountBanner,
  getAccountStatusState,
  loadAccountStatus,
  resetAccountStatus,
  subscribeToAccountStatus,
  type AccountStatusState,
} from "../../lib/accountStatus";
import type { OwnAccountStatus } from "../../lib/api";
import { registerManagementInvitationRefresh } from "../../hooks/useManagementInvitations";

/** The signed-in person's own account state, shared by the banner and the deletion notice. */
export function useOwnAccountStatus(options: { poll?: boolean } = {}): OwnAccountStatus | null {
  const { status, token } = useAuth();
  const signedIn = status === "authenticated" && Boolean(token);
  const [snapshot, setSnapshot] = useState<AccountStatusState>(() => getAccountStatusState());

  useEffect(() => subscribeToAccountStatus(setSnapshot), []);

  useEffect(() => {
    if (!options.poll) return;
    if (!signedIn || !token) {
      resetAccountStatus();
      return;
    }
    return registerManagementInvitationRefresh(async () => {
      await loadAccountStatus(token);
    }, document);
  }, [options.poll, signedIn, token]);

  return signedIn && snapshot.token === token ? snapshot.status : null;
}

/**
 * #2147: a suspended or closed account says so, persistently, in the same
 * in-flow slot as the other shell notices. It has no dismiss control: the
 * state is real until an operator lifts it. Drives the status poll, since the
 * shell is always mounted. Active or signed out: renders nothing.
 */
export default function AccountStatusBanner() {
  const status = useOwnAccountStatus({ poll: true });
  return <AccountStatusBannerView status={status} />;
}

/** Presentational, so the copy can be asserted without a session. */
export function AccountStatusBannerView({ status }: { status: OwnAccountStatus | null }) {
  const copy = describeAccountBanner(status);
  if (!copy) return null;
  return (
    <section
      role="region"
      aria-labelledby="account-status-banner-title"
      data-account-status={status?.status}
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "12px",
        padding: "10px 16px",
        borderBottom: "1px solid rgba(239, 68, 68, 0.28)",
        background: "rgba(239, 68, 68, 0.12)",
        color: "var(--color-text, #fff)",
        fontSize: "0.85rem",
        lineHeight: 1.5,
      }}
    >
      <p style={{ margin: 0, flex: "1 1 320px", minWidth: "220px" }}>
        <strong id="account-status-banner-title">{copy.title}</strong> — {copy.body}
      </p>
      <span style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
        <Link href="/help/account-suspension" style={{ textDecoration: "underline" }}>
          What this means and how to appeal
        </Link>
      </span>
    </section>
  );
}
