"use client";

import type { PlatformNotice } from "../../../lib/api";
import { PlatformNoticeBannerView } from "../../../components/notifications/PlatformNoticeBanner";
import PlatformNoticeItems from "../../../components/notifications/PlatformNoticeItems";
import { audienceShortLabel, type NoticeDraft } from "./NoticeComposer";

/** Distinct from the real banner's id, in case an operator's own banner is on the page too. */
export const PREVIEW_BANNER_HEADING_ID = "notice-preview-banner-title";

const PLACEHOLDER_TITLE = "Your title";
const PLACEHOLDER_BODY = "Your message will appear here.";

/** The notice as a person would receive it, built from the draft. */
export function toPreviewNotice(draft: NoticeDraft): PlatformNotice {
  return {
    id: "preview",
    kind: "broadcast",
    category: draft.category,
    title: draft.title.trim() || PLACEHOLDER_TITLE,
    body: draft.body.trim() || PLACEHOLDER_BODY,
    link: null,
    effectiveAt: draft.effectiveDate ? `${draft.effectiveDate}T00:00:00.000Z` : null,
    createdAt: new Date(0).toISOString(),
    readAt: null,
  };
}

/**
 * Live preview of the two places a broadcast appears: the banner at the top
 * of the app and a row in the notification bell. It renders the very same
 * views people see, without their action controls (no handlers are passed, so
 * no Dismiss and no "Mark as read"); `inert` keeps anything left from being
 * focusable or clickable, so nothing in the preview looks or acts like a dead control.
 */
export default function NoticePreview({ draft }: { draft: NoticeDraft }) {
  const notice = toPreviewNotice(draft);
  const empty = !draft.title.trim() && !draft.body.trim();
  return (
    <aside className="admin-notices-preview" aria-labelledby="notice-preview-title">
      <div className="admin-notices-preview__head">
        <h2 id="notice-preview-title">Live preview</h2>
        <p className="admin-form-hint">
          Updates as you type. Shown to {audienceShortLabel(draft.audience).toLowerCase()}.
        </p>
      </div>
      <div className="admin-notices-preview__frame" data-empty={empty ? "true" : undefined}>
        <p className="admin-notices-preview__label">Banner at the top of the app</p>
        <div className="admin-notices-preview__banner" inert>
          <PlatformNoticeBannerView notice={notice} headingId={PREVIEW_BANNER_HEADING_ID} />
        </div>
      </div>
      <div className="admin-notices-preview__frame" data-empty={empty ? "true" : undefined}>
        <p className="admin-notices-preview__label">In the notification bell</p>
        <div className="admin-notices-preview__bell" inert>
          <PlatformNoticeItems notices={[notice]} />
        </div>
      </div>
    </aside>
  );
}
