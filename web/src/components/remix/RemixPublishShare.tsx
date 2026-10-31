"use client";

import { useCallback } from "react";
import { ActionShare } from "../share/ActionShare";
import {
  remixShareAnalytics,
  remixShareMessage,
  remixShareUrl,
  type ShareChannel,
} from "../../lib/fanActionShare";
import { recordProductAnalyticsFromBrowser } from "../../lib/productAnalytics";

/**
 * Tailored share offered once a remix is published (#1915): "I just published
 * <remix>, my remix of <track> by <artist>", linking the public remix release
 * with utm_campaign=remix_share. No money claim.
 */
export function RemixPublishShare({
  releaseId,
  projectId,
  remixTitle,
  sourceTrackTitle,
  sourceArtistName,
}: {
  releaseId: string;
  projectId?: string | null;
  remixTitle?: string | null;
  sourceTrackTitle?: string | null;
  sourceArtistName?: string | null;
}) {
  const shareUrl = useCallback(
    (origin: string, channel: ShareChannel) => remixShareUrl(origin, releaseId, channel),
    [releaseId],
  );
  const message = useCallback(
    (channel: ShareChannel) => remixShareMessage({ remixTitle, sourceTrackTitle, sourceArtistName }, channel),
    [remixTitle, sourceArtistName, sourceTrackTitle],
  );
  const onShared = useCallback(
    (channel: ShareChannel) =>
      recordProductAnalyticsFromBrowser(
        "remix.published_shared",
        remixShareAnalytics({ releaseId, projectId }, channel),
      ),
    [projectId, releaseId],
  );
  return (
    <ActionShare
      kind="remix"
      label="Share your remix"
      shareUrl={shareUrl}
      message={message}
      onShared={onShared}
    />
  );
}

export default RemixPublishShare;
