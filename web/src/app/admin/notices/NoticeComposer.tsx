"use client";

import type {
  BroadcastNoticeInput,
  PlatformNoticeAudience,
  PlatformNoticeCategory,
  SentBroadcastNotice,
} from "../../../lib/api";
import { PlatformNoticeBannerView } from "../../../components/notifications/PlatformNoticeBanner";
import { NOTICE_CATEGORY_LABELS, formatNoticeEffectiveDate } from "../../../lib/platformNotices";

/** Limits mirror the server's (#2146); the server re-checks them. */
export const NOTICE_TITLE_MAX = 120;
export const NOTICE_BODY_MAX = 2000;

/** Operator broadcasts; moderation/account/refund notices are targeted and sent by the platform. */
export const BROADCAST_CATEGORIES: readonly PlatformNoticeCategory[] = ["policy", "terms", "incident"];

export const AUDIENCE_OPTIONS: ReadonlyArray<{ value: PlatformNoticeAudience; label: string }> = [
  { value: "all", label: "Everyone" },
  { value: "role:listener", label: "Listeners" },
  { value: "role:artist", label: "Artists (people with an artist profile)" },
  { value: "role:operator", label: "Operators" },
  { value: "role:admin", label: "Admins" },
];

export type NoticeDraft = {
  category: PlatformNoticeCategory;
  audience: PlatformNoticeAudience;
  title: string;
  body: string;
  /** `YYYY-MM-DD` from a date input, or "". */
  effectiveDate: string;
};

export const EMPTY_DRAFT: NoticeDraft = { category: "policy", audience: "all", title: "", body: "", effectiveDate: "" };

export type NoticeDraftErrors = Partial<Record<"title" | "body" | "effectiveDate", string>>;

export function validateNoticeDraft(draft: NoticeDraft): NoticeDraftErrors {
  const errors: NoticeDraftErrors = {};
  const title = draft.title.trim();
  const body = draft.body.trim();
  if (!title) errors.title = "Add a title.";
  else if (title.length > NOTICE_TITLE_MAX) errors.title = `Keep the title to ${NOTICE_TITLE_MAX} characters.`;
  if (!body) errors.body = "Add the message people will read.";
  else if (body.length > NOTICE_BODY_MAX) errors.body = `Keep the message to ${NOTICE_BODY_MAX} characters.`;
  if (draft.effectiveDate && Number.isNaN(new Date(`${draft.effectiveDate}T00:00:00Z`).getTime())) {
    errors.effectiveDate = "Use a valid date.";
  }
  return errors;
}

export function toBroadcastInput(draft: NoticeDraft): BroadcastNoticeInput {
  return {
    category: draft.category,
    audience: draft.audience,
    title: draft.title.trim(),
    body: draft.body.trim(),
    ...(draft.effectiveDate ? { effectiveAt: new Date(`${draft.effectiveDate}T00:00:00Z`).toISOString() } : {}),
  };
}

export function audienceLabel(audience: string) {
  return AUDIENCE_OPTIONS.find((option) => option.value === audience)?.label ?? audience;
}

export function getSendConfirmMessage(draft: NoticeDraft) {
  return (
    `Send "${draft.title.trim()}" to ${audienceLabel(draft.audience).toLowerCase()}? ` +
    "It appears in their notifications right away, including for people who sign up later, and cannot be edited or recalled."
  );
}

export default function NoticeComposer({
  draft,
  errors,
  showPreview,
  sending,
  onChange,
  onPreview,
  onRequestSend,
}: {
  draft: NoticeDraft;
  errors: NoticeDraftErrors;
  showPreview: boolean;
  sending: boolean;
  onChange: (field: keyof NoticeDraft, value: string) => void;
  onPreview: () => void;
  onRequestSend: () => void;
}) {
  const previewNotice = {
    id: "preview",
    kind: "broadcast" as const,
    category: draft.category,
    title: draft.title.trim() || "Title",
    body: draft.body.trim() || "Message",
    link: null,
    effectiveAt: draft.effectiveDate ? `${draft.effectiveDate}T00:00:00.000Z` : null,
    createdAt: new Date(0).toISOString(),
    readAt: null,
  };
  return (
    <section className="ui-card" style={{ padding: "20px", display: "grid", gap: "14px" }} aria-labelledby="notice-compose-title">
      <h2 id="notice-compose-title" style={{ margin: 0, fontSize: "1.1rem" }}>Compose a broadcast</h2>
      <p style={{ margin: 0, opacity: 0.7, fontSize: "0.85rem" }}>
        Broadcasts reach everyone in the audience, including people who sign up later. Do not include personal data.
      </p>
      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
        <label style={fieldStyle}>
          <span>Category</span>
          <select value={draft.category} onChange={(e) => onChange("category", e.target.value)}>
            {BROADCAST_CATEGORIES.map((category) => (
              <option key={category} value={category}>{NOTICE_CATEGORY_LABELS[category]}</option>
            ))}
          </select>
        </label>
        <label style={fieldStyle}>
          <span>Audience</span>
          <select value={draft.audience} onChange={(e) => onChange("audience", e.target.value)}>
            {AUDIENCE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label style={fieldStyle}>
          <span>Takes effect (optional)</span>
          <input type="date" value={draft.effectiveDate} onChange={(e) => onChange("effectiveDate", e.target.value)} />
          {errors.effectiveDate ? <span role="alert" style={errorStyle}>{errors.effectiveDate}</span> : null}
        </label>
      </div>
      <label style={fieldStyle}>
        <span>Title</span>
        <input
          type="text"
          value={draft.title}
          maxLength={NOTICE_TITLE_MAX + 20}
          onChange={(e) => onChange("title", e.target.value)}
        />
        {errors.title ? <span role="alert" style={errorStyle}>{errors.title}</span> : null}
      </label>
      <label style={fieldStyle}>
        <span>Message ({draft.body.trim().length}/{NOTICE_BODY_MAX})</span>
        <textarea rows={5} value={draft.body} onChange={(e) => onChange("body", e.target.value)} />
        {errors.body ? <span role="alert" style={errorStyle}>{errors.body}</span> : null}
      </label>
      {showPreview ? (
        <div aria-label="Preview" style={{ display: "grid", gap: "6px" }}>
          <span style={{ fontSize: "0.75rem", opacity: 0.6 }}>
            Preview: {audienceLabel(draft.audience)}
            {formatNoticeEffectiveDate(previewNotice.effectiveAt) ? ` · ${formatNoticeEffectiveDate(previewNotice.effectiveAt)}` : ""}
          </span>
          <PlatformNoticeBannerView notice={previewNotice} dismissing={false} onDismiss={() => {}} />
        </div>
      ) : null}
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
        <button type="button" className="ui-btn ui-btn-ghost" onClick={onPreview} disabled={sending}>
          Preview
        </button>
        <button type="button" className="ui-btn ui-btn-primary" onClick={onRequestSend} disabled={sending}>
          {sending ? "Sending..." : "Review and send"}
        </button>
      </div>
    </section>
  );
}

export function SentNoticesList({
  state,
  onRetry,
}: {
  state: { status: "loading" } | { status: "error" } | { status: "ready"; notices: SentBroadcastNotice[] };
  onRetry: () => void;
}) {
  return (
    <section className="ui-card" style={{ padding: "20px", display: "grid", gap: "10px" }} aria-labelledby="notice-sent-title">
      <h2 id="notice-sent-title" style={{ margin: 0, fontSize: "1.1rem" }}>Sent broadcasts</h2>
      {state.status === "loading" ? <p style={{ margin: 0, opacity: 0.6 }}>Loading...</p> : null}
      {state.status === "error" ? (
        <p style={{ margin: 0 }}>
          Could not load sent broadcasts.{" "}
          <button type="button" className="ui-btn ui-btn-ghost" onClick={onRetry}>Retry</button>
        </p>
      ) : null}
      {state.status === "ready" && state.notices.length === 0 ? (
        <p style={{ margin: 0, opacity: 0.6 }}>No broadcasts sent yet.</p>
      ) : null}
      {state.status === "ready"
        ? state.notices.map((notice) => (
            <article key={notice.id} style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "10px" }}>
              <div style={{ fontSize: "0.75rem", opacity: 0.6 }}>
                {NOTICE_CATEGORY_LABELS[notice.category]} · {audienceLabel(notice.audience)} ·{" "}
                {new Date(notice.createdAt).toLocaleString()} · read by {notice.readCount}
                {notice.active ? "" : " · expired"}
              </div>
              <strong>{notice.title}</strong>
              <p style={{ margin: "4px 0 0", opacity: 0.8, whiteSpace: "pre-line" }}>{notice.body}</p>
            </article>
          ))
        : null}
    </section>
  );
}

const fieldStyle: React.CSSProperties = { display: "grid", gap: "4px", fontSize: "0.85rem", minWidth: "200px" };
const errorStyle: React.CSSProperties = { color: "#f87171", fontSize: "0.75rem" };
