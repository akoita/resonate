"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { getContactEmail, setContactEmail, type ContactEmailState } from "../../lib/api";
import {
  CONTACT_EMAIL_MAX_LENGTH,
  describeContactEmailError,
  validateContactEmailInput,
} from "../../lib/contactEmail";
import {
  EMAIL_PROMPT_COPY,
  EMAIL_PROMPT_DISCLOSURE,
  EMAIL_PROMPT_SETTINGS_HREF,
  dismissEmailPrompt,
  isEmailPromptDismissed,
  shouldShowEmailPrompt,
  type EmailPromptContext,
} from "../../lib/emailPrompt";
import { recordProductAnalytics } from "../../lib/productAnalytics";
import { useAuth } from "../auth/AuthProvider";

/**
 * #2182: measurement reuses the existing consent-gated onboarding events
 * (`recordProductAnalytics` sends nothing without analytics consent). Counts
 * only: the moment (`step`) and what happened, never the address.
 *   step_viewed    -> a person was prompted
 *   step_completed -> they added an address (`address_added`) or opened Settings to
 *   abandoned      -> they dismissed it
 * Confirmation happens on a public link with no session, so confirmed counts
 * come from the server's own records, not from the browser.
 */
const FLOW = "email_notices";

export type EmailPromptCardViewProps = {
  context: EmailPromptContext;
  /** The onboarding step types the address right here; the others link to Settings. */
  inline: boolean;
  /** The address form is open (inline only). */
  expanded: boolean;
  draft: string;
  draftError: string | null;
  actionError: string | null;
  busy: boolean;
  /** Set once the confirmation email was sent from this card. */
  sent: boolean;
  onExpand: () => void;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
  onOpenSettings: () => void;
  onDismiss: () => void;
};

/** Presentational, so every state can be asserted statically. */
export function EmailPromptCardView(props: EmailPromptCardViewProps) {
  const { context, inline, expanded, busy, sent } = props;
  const copy = EMAIL_PROMPT_COPY[context];
  const headingId = `email-prompt-${context}-title`;

  if (sent) {
    return (
      <section className="email-prompt" data-context={context} data-state="sent" aria-labelledby={headingId}>
        <div className="email-prompt__text">
          <strong id={headingId}>Check your inbox</strong>
          <p>
            We sent a link to confirm your address. Until you open it, nothing is emailed to you. You can
            change this any time in Settings.
          </p>
        </div>
        <div className="email-prompt__actions">
          <button type="button" className="ui-btn ui-btn-ghost" onClick={props.onDismiss}>
            Done
          </button>
        </div>
      </section>
    );
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    props.onSubmit();
  };

  return (
    <section
      className="email-prompt"
      data-context={context}
      data-state={expanded ? "form" : "invite"}
      aria-labelledby={headingId}
    >
      <div className="email-prompt__text">
        <strong id={headingId}>{copy.heading}</strong>
        <p>{copy.body}</p>
      </div>

      {inline && expanded ? (
        <form className="email-prompt__form" onSubmit={handleSubmit} noValidate>
          <label className="email-prompt__label" htmlFor={`email-prompt-${context}-address`}>
            Email address
          </label>
          <input
            id={`email-prompt-${context}-address`}
            className="ui-input"
            type="email"
            inputMode="email"
            autoComplete="email"
            maxLength={CONTACT_EMAIL_MAX_LENGTH}
            placeholder="you@example.com"
            value={props.draft}
            onChange={(event) => props.onDraftChange(event.target.value)}
            aria-invalid={props.draftError ? true : undefined}
            aria-describedby={props.draftError ? `email-prompt-${context}-error` : undefined}
            disabled={busy}
          />
          {props.draftError ? (
            <p id={`email-prompt-${context}-error`} className="email-prompt__error" role="alert">
              {props.draftError}
            </p>
          ) : null}
          {props.actionError ? (
            <p className="email-prompt__error" role="alert">
              {props.actionError}
            </p>
          ) : null}
          <p className="email-prompt__disclosure">{EMAIL_PROMPT_DISCLOSURE}</p>
          <div className="email-prompt__actions">
            <button type="submit" className="ui-btn ui-btn-primary" disabled={busy}>
              {busy ? "Sending..." : "Send confirmation"}
            </button>
            <button type="button" className="ui-btn ui-btn-ghost" onClick={props.onDismiss} disabled={busy}>
              Skip
            </button>
          </div>
        </form>
      ) : (
        <div className="email-prompt__actions">
          {inline ? (
            <button type="button" className="ui-btn ui-btn-primary" onClick={props.onExpand}>
              Add an email
            </button>
          ) : (
            <Link
              href={EMAIL_PROMPT_SETTINGS_HREF}
              className="ui-btn ui-btn-primary"
              onClick={props.onOpenSettings}
            >
              Add an email
            </Link>
          )}
          <button type="button" className="ui-btn ui-btn-ghost" onClick={props.onDismiss}>
            {inline ? "Skip" : "Not now"}
          </button>
        </div>
      )}
    </section>
  );
}

/**
 * Whether to show the prompt for `context` right now, and how to dismiss it.
 * Nothing is requested for a signed-out visitor, once the prompt was dismissed
 * in this browser, or while `enabled` is false.
 */
export function useEmailPrompt(context: EmailPromptContext, enabled = true) {
  const { status, token, userId } = useAuth();
  // Kept with the account it was loaded for, so a previous account's answer is never reused.
  const [loaded, setLoaded] = useState<{ userId: string; contact: ContactEmailState } | null>(null);
  const [dismissedNow, setDismissedNow] = useState(false);
  const signedIn = status === "authenticated" && Boolean(token) && Boolean(userId);

  useEffect(() => {
    if (!enabled || !signedIn || !userId || !token) return;
    // A dismissed prompt costs no request.
    if (isEmailPromptDismissed(userId, context)) return;
    let active = true;
    getContactEmail(token).then(
      (contact) => {
        if (active) setLoaded({ userId, contact });
      },
      // A prompt is a nicety: if the address cannot be looked up, show nothing.
      () => {
        if (active) setLoaded(null);
      },
    );
    return () => {
      active = false;
    };
  }, [context, enabled, signedIn, token, userId]);

  const dismiss = useCallback(() => {
    if (userId) dismissEmailPrompt(userId, context);
    setDismissedNow(true);
  }, [context, userId]);

  const contact = loaded && loaded.userId === userId ? loaded.contact : null;
  const dismissed = dismissedNow || !userId || isEmailPromptDismissed(userId, context);

  return {
    visible: enabled && signedIn && shouldShowEmailPrompt({ contact, dismissed }),
    token,
    dismiss,
  };
}

/**
 * A small, dismissible, never-blocking invitation to add an optional email
 * address for platform notices. Renders nothing unless the person has no
 * address on file and has not dismissed this moment's prompt.
 */
export default function EmailPromptCard({
  context,
  enabled = true,
  onNavigate,
}: {
  context: EmailPromptContext;
  enabled?: boolean;
  /** Called when "Add an email" opens Settings, e.g. so a dropdown can close. */
  onNavigate?: () => void;
}) {
  const { visible, token, dismiss } = useEmailPrompt(context, enabled);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const viewed = useRef(false);
  const inline = context === "onboarding";

  const track = useCallback(
    (eventName: "onboarding.step_viewed" | "onboarding.step_completed" | "onboarding.abandoned", extra: Record<string, string>) => {
      void recordProductAnalytics(token, eventName, {
        source: "email_prompt",
        payload: { flow: FLOW, step: context, ...extra },
      });
    },
    [context, token],
  );

  useEffect(() => {
    if (!visible || viewed.current) return;
    viewed.current = true;
    track("onboarding.step_viewed", {});
  }, [track, visible]);

  if (!visible && !sent) return null;

  const submit = async () => {
    if (!token || busy) return;
    const problem = validateContactEmailInput(draft);
    setDraftError(problem);
    if (problem) return;
    setBusy(true);
    setActionError(null);
    try {
      await setContactEmail(token, draft.trim());
      track("onboarding.step_completed", { action: "address_added" });
      setSent(true);
    } catch (error) {
      setActionError(describeContactEmailError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <EmailPromptCardView
      context={context}
      inline={inline}
      expanded={expanded}
      draft={draft}
      draftError={draftError}
      actionError={actionError}
      busy={busy}
      sent={sent}
      onExpand={() => setExpanded(true)}
      onDraftChange={(value) => {
        setDraft(value);
        setDraftError(null);
      }}
      onSubmit={() => void submit()}
      onOpenSettings={() => {
        track("onboarding.step_completed", { action: "opened_settings" });
        onNavigate?.();
      }}
      onDismiss={() => {
        if (!sent) track("onboarding.abandoned", { reason: "dismissed" });
        dismiss();
        setSent(false);
      }}
    />
  );
}
