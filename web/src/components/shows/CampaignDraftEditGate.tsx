"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { campaignHref, type Campaign } from "../../lib/shows";
import { useCampaignManageAccess } from "./useCampaignManageAccess";

/**
 * #2130: shows the draft editor only to viewers the backend lets manage the
 * campaign, instead of a form whose save would be rejected. Signed-out viewers
 * fall through to the form, which renders its own connect prompt.
 */
export function CampaignDraftEditGate({ campaign, children }: {
  campaign: Pick<Campaign, "id" | "backendId" | "rawStatus">;
  children: ReactNode;
}) {
  const access = useCampaignManageAccess(campaign);

  if (access === "checking") {
    return (
      <section className="shows-create__panel" aria-live="polite">
        <p>Checking edit access…</p>
      </section>
    );
  }

  if (access === "denied") {
    return (
      <section className="shows-create__panel">
        <h2>You can&apos;t edit this draft</h2>
        <p>Only the campaign&apos;s artist or a Resonate operator can edit it.</p>
        <Link href={campaignHref(campaign)}>Back to campaign</Link>
      </section>
    );
  }

  return <>{children}</>;
}
