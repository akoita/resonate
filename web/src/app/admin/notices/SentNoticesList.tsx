"use client";

import { ReviewQueueStatePanel } from "../../../components/admin/review-queue/ReviewQueue";
import type { SentBroadcastNotice } from "../../../lib/api";
import { NOTICE_CATEGORY_LABELS, formatNoticeEffectiveDate } from "../../../lib/platformNotices";
import { audienceShortLabel } from "./NoticeComposer";

export type SentNoticesState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; notices: SentBroadcastNotice[] };

function formatDay(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * How many have read it. A share is only drawn for "everyone" broadcasts,
 * against today's head count from the users overview: the API reports the
 * number who read it, not how many it reached, so other audiences show the
 * count alone.
 */
function ReadCount({ notice, audienceSize }: { notice: SentBroadcastNotice; audienceSize: number | null }) {
  const read = notice.readCount.toLocaleString("en-GB");
  if (notice.audience !== "all" || !audienceSize || audienceSize <= 0) {
    return <p className="admin-notices-sent__read">Read by {read}</p>;
  }
  const percent = Math.min(100, Math.round((notice.readCount / audienceSize) * 100));
  return (
    <div className="admin-notices-sent__rate">
      <p className="admin-notices-sent__read">
        Read by {read} of about {audienceSize.toLocaleString("en-GB")} people today ({percent}%)
      </p>
      <div className="admin-notices-bar" aria-hidden="true">
        <span style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function SentNoticeCard({ notice, audienceSize }: { notice: SentBroadcastNotice; audienceSize: number | null }) {
  const sent = formatDay(notice.createdAt);
  const effective = formatNoticeEffectiveDate(notice.effectiveAt);
  const expires = notice.expiresAt ? formatDay(notice.expiresAt) : null;
  return (
    <article className="admin-notices-sent__card" data-notice-id={notice.id}>
      <div className="admin-notices-sent__chips">
        <span className="admin-notices-chip" data-category={notice.category}>
          {NOTICE_CATEGORY_LABELS[notice.category]}
        </span>
        <span className="admin-notices-chip admin-notices-chip--audience">{audienceShortLabel(notice.audience)}</span>
        {notice.active ? null : <span className="admin-notices-chip admin-notices-chip--expired">Expired</span>}
        {sent ? (
          <time className="admin-notices-sent__date" dateTime={notice.createdAt}>
            Sent {sent}
          </time>
        ) : null}
      </div>
      <h3>{notice.title}</h3>
      <p className="admin-notices-sent__body">{notice.body}</p>
      {effective || expires ? (
        <p className="admin-notices-sent__meta">
          {[effective, expires ? `Expires ${expires}` : null].filter(Boolean).join(" · ")}
        </p>
      ) : null}
      <ReadCount notice={notice} audienceSize={audienceSize} />
    </article>
  );
}

export default function SentNoticesList({
  state,
  audienceSize,
  onRetry,
}: {
  state: SentNoticesState;
  audienceSize: number | null;
  onRetry: () => void;
}) {
  return (
    <section className="admin-notices-sent" aria-labelledby="notice-sent-title">
      <h2 id="notice-sent-title">Sent broadcasts</h2>
      {state.status === "loading" ? (
        <div className="admin-notices-sent__loading" aria-busy="true">
          <p className="visually-hidden" role="status">Loading sent broadcasts...</p>
          <span aria-hidden="true" />
          <span aria-hidden="true" />
        </div>
      ) : null}
      {state.status === "error" ? (
        <ReviewQueueStatePanel
          variant="error"
          heading="Could not load sent broadcasts"
          body="Your sent broadcasts are safe; they just did not load."
          actionLabel="Retry"
          onAction={onRetry}
        />
      ) : null}
      {state.status === "ready" && state.notices.length === 0 ? (
        <ReviewQueueStatePanel
          variant="empty"
          heading="No broadcasts yet"
          body="Your first one appears here once you send it."
        />
      ) : null}
      {state.status === "ready" && state.notices.length > 0 ? (
        <div className="admin-notices-sent__list">
          {state.notices.map((notice) => (
            <SentNoticeCard key={notice.id} notice={notice} audienceSize={audienceSize} />
          ))}
        </div>
      ) : null}
    </section>
  );
}
