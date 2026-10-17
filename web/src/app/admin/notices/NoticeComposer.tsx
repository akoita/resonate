"use client";

import type { BroadcastNoticeInput, PlatformNoticeAudience, PlatformNoticeCategory } from "../../../lib/api";
import { isEmailRequiredCategory } from "../../../lib/contactEmail";
import { NOTICE_CATEGORY_LABELS } from "../../../lib/platformNotices";

/** Limits mirror the server's (#2146); the server re-checks them. */
export const NOTICE_TITLE_MAX = 120;
export const NOTICE_BODY_MAX = 2000;

/** Operator broadcasts; moderation/account/refund notices are targeted and sent by the platform. */
export const BROADCAST_CATEGORIES: readonly PlatformNoticeCategory[] = ["policy", "terms", "incident"];

/** What each broadcast category is for, in the words an operator would pick it by. */
export const CATEGORY_DESCRIPTIONS: Partial<Record<PlatformNoticeCategory, string>> = {
  policy: "A change to how the platform works or what is allowed.",
  terms: "A change to the terms of use people agreed to.",
  incident: "An outage, a security issue, or anything people need to know right now.",
};

export const AUDIENCE_OPTIONS: ReadonlyArray<{
  value: PlatformNoticeAudience;
  /** Full wording, used in the confirmation and in lists. */
  label: string;
  /** Compact wording for the segmented control and chips. */
  short: string;
  /** Who receives it, for audiences that have no head count. */
  reach: string;
}> = [
  { value: "all", label: "Everyone", short: "Everyone", reach: "everyone with an account" },
  { value: "role:listener", label: "Listeners", short: "Listeners", reach: "people with a listener account" },
  {
    value: "role:artist",
    label: "Artists (people with an artist profile)",
    short: "Artists",
    reach: "people with an artist profile",
  },
  { value: "role:operator", label: "Operators", short: "Operators", reach: "platform operators" },
  { value: "role:admin", label: "Admins", short: "Admins", reach: "platform admins" },
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

export function audienceShortLabel(audience: string) {
  return AUDIENCE_OPTIONS.find((option) => option.value === audience)?.short ?? audience;
}

export function getSendConfirmMessage(draft: NoticeDraft) {
  return (
    `Send "${draft.title.trim()}" to ${audienceLabel(draft.audience).toLowerCase()}? ` +
    "It appears in their notifications right away, including for people who sign up later, and cannot be edited or recalled."
  );
}

/**
 * Who a broadcast reaches. Only "everyone" has a head count (the users
 * overview); it is left out, not guessed, while that is unknown.
 */
export function getAudienceReachText(audience: PlatformNoticeAudience, audienceSize: number | null): string {
  if (audience === "all") {
    return audienceSize === null
      ? "Reaches everyone with an account today, plus anyone who signs up later."
      : `Reaches about ${audienceSize.toLocaleString("en-GB")} people today, plus anyone who signs up later.`;
  }
  const reach = AUDIENCE_OPTIONS.find((option) => option.value === audience)?.reach ?? audienceLabel(audience);
  return `Reaches ${reach}, now and as they join later.`;
}

/** How a notice also reaches people by email (#2169), by whether the category can be switched off. */
export function getEmailReachText(category: PlatformNoticeCategory): string {
  return isEmailRequiredCategory(category)
    ? `Also emailed to people with a confirmed email address. ${NOTICE_CATEGORY_LABELS[category]} notices are required, so nobody can turn them off.`
    : "Also emailed to people with a confirmed email address, unless they turned this category off.";
}

export default function NoticeComposer({
  draft,
  errors,
  sending,
  audienceSize,
  onChange,
  onRequestSend,
}: {
  draft: NoticeDraft;
  /** Problems found when the operator tried to send; cleared per field on edit. */
  errors: NoticeDraftErrors;
  sending: boolean;
  /** People on the platform today, from the users overview; null when unknown. */
  audienceSize: number | null;
  onChange: (field: keyof NoticeDraft, value: string) => void;
  onRequestSend: () => void;
}) {
  const found = validateNoticeDraft(draft);
  const valid = Object.keys(found).length === 0;
  const titleLength = draft.title.trim().length;
  const bodyLength = draft.body.trim().length;
  // Too-long and bad-date problems are shown as you type; "add a title" waits
  // for the operator to try to send, as it always has.
  const titleError = errors.title ?? (titleLength > NOTICE_TITLE_MAX ? found.title : undefined);
  const bodyError = errors.body ?? (bodyLength > NOTICE_BODY_MAX ? found.body : undefined);
  const dateError = errors.effectiveDate ?? found.effectiveDate;
  // Say why the button is off, unless an error beside a field already does.
  const blocker = found.title ?? found.body ?? found.effectiveDate ?? null;
  const showBlocker = Boolean(blocker) && !sending && !(titleError || bodyError || dateError);
  return (
    <form
      className="admin-notices-composer"
      aria-labelledby="notice-compose-title"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid && !sending) onRequestSend();
      }}
    >
      <div className="admin-notices-composer__head">
        <h2 id="notice-compose-title">Compose a broadcast</h2>
        <p className="admin-form-hint">
          Broadcasts reach everyone in the audience, including people who sign up later. Once sent, a broadcast cannot
          be edited or recalled.
        </p>
      </div>

      <fieldset className="admin-form-group">
        <legend className="admin-form-label">Category</legend>
        <div className="admin-form-choices">
          {BROADCAST_CATEGORIES.map((category) => (
            <label key={category} className="admin-form-choice" data-category={category}>
              <input
                type="radio"
                name="notice-category"
                value={category}
                checked={draft.category === category}
                onChange={() => onChange("category", category)}
              />
              <span className="admin-form-choice__body">
                <span className="admin-form-choice__title">{NOTICE_CATEGORY_LABELS[category]}</span>
                <span className="admin-form-choice__text">{CATEGORY_DESCRIPTIONS[category]}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="admin-form-group">
        <legend className="admin-form-label">Audience</legend>
        <div className="admin-form-segment">
          {AUDIENCE_OPTIONS.map((option) => (
            <label key={option.value} className="admin-form-segment__option">
              <input
                type="radio"
                name="notice-audience"
                value={option.value}
                checked={draft.audience === option.value}
                onChange={() => onChange("audience", option.value)}
              />
              <span>{option.short}</span>
            </label>
          ))}
        </div>
        <div className="admin-notices-reach">
          <p className="admin-notices-reach__title">Who receives it</p>
          <p>{getAudienceReachText(draft.audience, audienceSize)}</p>
          <p className="admin-notices-reach__email">{getEmailReachText(draft.category)}</p>
        </div>
      </fieldset>

      <div className="admin-form-field">
        <div className="admin-form-label-row">
          <label className="admin-form-label" htmlFor="notice-title">Title</label>
          <span className="admin-form-counter" data-over={titleLength > NOTICE_TITLE_MAX ? "true" : undefined}>
            {titleLength}/{NOTICE_TITLE_MAX}
          </span>
        </div>
        <input
          id="notice-title"
          className="admin-form-input"
          type="text"
          value={draft.title}
          maxLength={NOTICE_TITLE_MAX + 20}
          placeholder="e.g. Updated artist terms"
          aria-invalid={titleError ? true : undefined}
          aria-describedby={titleError ? "notice-title-error" : undefined}
          onChange={(e) => onChange("title", e.target.value)}
        />
        {titleError ? <p id="notice-title-error" role="alert" className="admin-form-error">{titleError}</p> : null}
      </div>

      <div className="admin-form-field">
        <div className="admin-form-label-row">
          <label className="admin-form-label" htmlFor="notice-body">Message</label>
          <span className="admin-form-counter" data-over={bodyLength > NOTICE_BODY_MAX ? "true" : undefined}>
            {bodyLength}/{NOTICE_BODY_MAX}
          </span>
        </div>
        <textarea
          id="notice-body"
          className="admin-form-input admin-form-textarea"
          rows={6}
          value={draft.body}
          placeholder="What is changing, and what people need to do about it."
          aria-invalid={bodyError ? true : undefined}
          aria-describedby={bodyError ? "notice-body-error notice-body-hint" : "notice-body-hint"}
          onChange={(e) => onChange("body", e.target.value)}
        />
        <p id="notice-body-hint" className="admin-form-hint">Do not include personal data.</p>
        {bodyError ? <p id="notice-body-error" role="alert" className="admin-form-error">{bodyError}</p> : null}
      </div>

      <div className="admin-form-field admin-notices-date">
        <label className="admin-form-label" htmlFor="notice-effective">
          Takes effect <span className="admin-form-optional">(optional)</span>
        </label>
        <input
          id="notice-effective"
          className="admin-form-input"
          type="date"
          value={draft.effectiveDate}
          aria-invalid={dateError ? true : undefined}
          aria-describedby={dateError ? "notice-effective-error" : undefined}
          onChange={(e) => onChange("effectiveDate", e.target.value)}
        />
        {dateError ? <p id="notice-effective-error" role="alert" className="admin-form-error">{dateError}</p> : null}
      </div>

      <div className="admin-notices-composer__actions">
        <button type="submit" className="ui-btn ui-btn-primary" disabled={sending || !valid}>
          {sending ? "Sending..." : "Review and send"}
        </button>
        {showBlocker ? <p className="admin-form-hint admin-notices-blocker">{blocker}</p> : null}
      </div>
    </form>
  );
}
