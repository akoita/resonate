"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  confirmContactEmail,
  unsubscribeEmail,
  type PlatformNoticeCategory,
} from "../../lib/api";
import {
  CONTACT_EMAIL_ERROR_MESSAGES,
  contactEmailErrorCode,
  describeContactEmailError,
} from "../../lib/contactEmail";
import { NOTICE_CATEGORY_LABELS } from "../../lib/platformNotices";

/**
 * #2169: the two pages a notice email links to. Neither needs a sign-in — the
 * token in the link is the proof — so they never ask for one.
 */

export const EMAIL_SETTINGS_HREF = "/settings?section=email";

function LandingCard({
  title,
  tone,
  children,
}: {
  title: string;
  tone: "good" | "warning" | "neutral";
  children: React.ReactNode;
}) {
  return (
    <main className="email-landing">
      <section className="email-landing__card" data-tone={tone}>
        <h1>{title}</h1>
        {children}
      </section>
    </main>
  );
}

// ---------------------------------------------------------------- confirm

export type ConfirmEmailState =
  | { status: "missing" }
  | { status: "working" }
  | { status: "confirmed" }
  | { status: "invalid" }
  | { status: "error"; message: string };

export function ConfirmEmailView({
  state,
  onRetry,
}: {
  state: ConfirmEmailState;
  onRetry: () => void;
}) {
  if (state.status === "working") {
    return (
      <LandingCard title="Confirming your email..." tone="neutral">
        <p role="status">One moment.</p>
      </LandingCard>
    );
  }
  if (state.status === "confirmed") {
    return (
      <LandingCard title="Email confirmed" tone="good">
        <p role="status">
          Thank you. We will now email you the platform notices you have switched on. This address is used
          only for platform notices, never for marketing.
        </p>
        <p>
          You can choose which notices to receive, or remove the address, in{" "}
          <Link href={EMAIL_SETTINGS_HREF}>Settings</Link>.
        </p>
      </LandingCard>
    );
  }
  if (state.status === "error") {
    return (
      <LandingCard title="We could not confirm your email" tone="warning">
        <p role="alert">{state.message}</p>
        <div className="email-landing__actions">
          <button type="button" className="ui-btn ui-btn-primary" onClick={onRetry}>
            Try again
          </button>
        </div>
      </LandingCard>
    );
  }
  const missing = state.status === "missing";
  return (
    <LandingCard title="This link does not work" tone="warning">
      <p role="alert">
        {missing
          ? "This page needs the link from your confirmation email. Open the link in the email again."
          : CONTACT_EMAIL_ERROR_MESSAGES.invalid_or_expired}
      </p>
      <div className="email-landing__actions">
        <Link href={EMAIL_SETTINGS_HREF} className="ui-btn ui-btn-primary">
          Go to email settings
        </Link>
      </div>
    </LandingCard>
  );
}

/** Confirms once on load. A retry is only offered after a failure that is not the link's fault. */
export function ConfirmEmailClient({ token }: { token: string | null }) {
  const [state, setState] = useState<ConfirmEmailState>(
    token ? { status: "working" } : { status: "missing" },
  );
  const started = useRef(false);

  const confirm = useCallback((value: string) => {
    confirmContactEmail(value).then(
      () => setState({ status: "confirmed" }),
      (error: unknown) =>
        setState(
          contactEmailErrorCode(error) === "invalid_or_expired"
            ? { status: "invalid" }
            : { status: "error", message: describeContactEmailError(error) },
        ),
    );
  }, []);

  useEffect(() => {
    // Exactly once: a StrictMode remount must not spend the single-use token twice.
    if (!token || started.current) return;
    started.current = true;
    confirm(token);
  }, [token, confirm]);

  return (
    <ConfirmEmailView
      state={state}
      onRetry={() => {
        if (!token) return;
        setState({ status: "working" });
        confirm(token);
      }}
    />
  );
}

// ------------------------------------------------------------ unsubscribe

export type UnsubscribeState =
  | { status: "missing" }
  | { status: "ready" }
  | { status: "working" }
  | { status: "done"; category: PlatformNoticeCategory | null }
  | { status: "invalid" }
  | { status: "error"; message: string };

export function UnsubscribeView({
  state,
  onUnsubscribe,
}: {
  state: UnsubscribeState;
  onUnsubscribe: () => void;
}) {
  if (state.status === "ready" || state.status === "working") {
    const working = state.status === "working";
    return (
      <LandingCard title="Stop these emails?" tone="neutral">
        <p>
          You will stop getting this kind of platform notice by email. Every notice still appears in the
          app, in the notification bell.
        </p>
        <div className="email-landing__actions">
          <button
            type="button"
            className="ui-btn ui-btn-primary"
            onClick={onUnsubscribe}
            disabled={working}
          >
            {working ? "Stopping..." : "Stop these emails"}
          </button>
          <Link href={EMAIL_SETTINGS_HREF} className="ui-btn ui-btn-ghost">
            Open email settings instead
          </Link>
        </div>
      </LandingCard>
    );
  }
  if (state.status === "done") {
    const label = state.category ? NOTICE_CATEGORY_LABELS[state.category] : null;
    return (
      <LandingCard title="You are unsubscribed" tone="good">
        <p role="status">
          {label
            ? `We will no longer email you ${label} notices.`
            : "We will no longer email you this kind of notice."}{" "}
          You will still see them in the app.
        </p>
        <p>
          Changed your mind, or want to adjust other notices? Open{" "}
          <Link href={EMAIL_SETTINGS_HREF}>email settings</Link>.
        </p>
      </LandingCard>
    );
  }
  if (state.status === "error") {
    return (
      <LandingCard title="We could not unsubscribe you" tone="warning">
        <p role="alert">{state.message}</p>
        <div className="email-landing__actions">
          <button type="button" className="ui-btn ui-btn-primary" onClick={onUnsubscribe}>
            Try again
          </button>
          <Link href={EMAIL_SETTINGS_HREF} className="ui-btn ui-btn-ghost">
            Open email settings
          </Link>
        </div>
      </LandingCard>
    );
  }
  return (
    <LandingCard title="This link does not work" tone="warning">
      <p role="alert">
        {state.status === "missing"
          ? "This page needs the link from a notice email. Open the unsubscribe link in the email again."
          : CONTACT_EMAIL_ERROR_MESSAGES.invalid}
      </p>
      <div className="email-landing__actions">
        <Link href={EMAIL_SETTINGS_HREF} className="ui-btn ui-btn-primary">
          Go to email settings
        </Link>
      </div>
    </LandingCard>
  );
}

/**
 * Unsubscribing needs a click. Mail scanners and link previews open links on
 * their own, so a page that acted on load would unsubscribe people who never
 * asked to be.
 */
export function UnsubscribeClient({ token }: { token: string | null }) {
  const [state, setState] = useState<UnsubscribeState>(token ? { status: "ready" } : { status: "missing" });

  const unsubscribe = () => {
    if (!token) return;
    setState({ status: "working" });
    unsubscribeEmail(token).then(
      (result) => setState({ status: "done", category: result?.category ?? null }),
      (error: unknown) =>
        setState(
          contactEmailErrorCode(error) === "invalid"
            ? { status: "invalid" }
            : { status: "error", message: describeContactEmailError(error) },
        ),
    );
  };

  return <UnsubscribeView state={state} onUnsubscribe={unsubscribe} />;
}
