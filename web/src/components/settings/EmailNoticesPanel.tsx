"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  getContactEmail,
  removeContactEmail,
  resendContactEmailConfirmation,
  setContactEmail,
  setContactEmailPreferences,
  type ContactEmailState,
  type PlatformNoticeCategory,
} from "../../lib/api";
import {
  CONTACT_EMAIL_MAX_LENGTH,
  CONTACT_EMAIL_PROMISE,
  EMAIL_CATEGORY_DESCRIPTIONS,
  describeContactEmailError,
  optOutsAfterToggle,
  requiredReason,
  validateContactEmailInput,
} from "../../lib/contactEmail";
import { NOTICE_CATEGORY_LABELS } from "../../lib/platformNotices";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";

type ToastFn = (toast: { type: "success" | "error" | "info" | "warning"; title: string; message: string }) => void;

type Props = {
  token: string | null | undefined;
  addToast: ToastFn;
};

export type EmailNoticesLoad =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; contact: ContactEmailState };

export type EmailNoticesBusy = "saving" | "resending" | "removing" | "preferences" | null;

export type EmailNoticesViewProps = {
  load: EmailNoticesLoad;
  /** What is typed in the address box. */
  draft: string;
  draftError: string | null;
  /** An error from the last action, shown next to the controls. */
  actionError: string | null;
  busy: EmailNoticesBusy;
  /** The person asked to change a pending or confirmed address. */
  editing: boolean;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
  onStartEditing: () => void;
  onCancelEditing: () => void;
  onResend: () => void;
  onRemove: () => void;
  onToggleCategory: (category: PlatformNoticeCategory, enabled: boolean) => void;
  onRetry: () => void;
};

export function formatConfirmationSent(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

const DISABLED_EXPLANATION = {
  hard_bounce:
    "Emails to this address bounced, so we stopped sending to it. Check it for typos, or use a different address.",
  complaint:
    "This address marked a notice as unwanted, so we stopped sending to it. Use a different address if you still want notices by email.",
} as const;

function AddressForm({
  draft,
  draftError,
  busy,
  submitLabel,
  allowCancel,
  onDraftChange,
  onSubmit,
  onCancel,
}: {
  draft: string;
  draftError: string | null;
  busy: EmailNoticesBusy;
  submitLabel: string;
  allowCancel: boolean;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };
  return (
    <form className="email-notices__form" onSubmit={handleSubmit} noValidate>
      <label className="email-notices__label" htmlFor="email-notices-address">
        Email address
      </label>
      <input
        id="email-notices-address"
        className="ui-input"
        type="email"
        inputMode="email"
        autoComplete="email"
        maxLength={CONTACT_EMAIL_MAX_LENGTH}
        placeholder="you@example.com"
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
        aria-invalid={draftError ? true : undefined}
        aria-describedby={draftError ? "email-notices-address-error" : undefined}
        disabled={busy === "saving"}
      />
      {draftError ? (
        <p id="email-notices-address-error" className="email-notices__field-error" role="alert">
          {draftError}
        </p>
      ) : null}
      <div className="email-notices__actions">
        <button type="submit" className="ui-btn ui-btn-primary" disabled={busy !== null}>
          {busy === "saving" ? "Sending..." : submitLabel}
        </button>
        {allowCancel ? (
          <Button variant="ghost" onClick={onCancel} disabled={busy !== null}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function AddressRow({ address, chip }: { address: string; chip: { label: string; tone: string } }) {
  return (
    <div className="email-notices__address">
      <span className="email-notices__address-text">{address}</span>
      <span className="email-notices__chip" data-tone={chip.tone}>
        {chip.label}
      </span>
    </div>
  );
}

/**
 * #2169: the optional email address for platform notices. Presentational, so
 * every state (unavailable, none, pending, confirmed, disabled) can be asserted
 * statically; `EmailNoticesPanel` below owns the requests.
 */
export function EmailNoticesView(props: EmailNoticesViewProps) {
  const { load, busy, actionError } = props;

  if (load.status === "loading") {
    return (
      <div className="usage-empty" role="status">
        Loading your email settings...
      </div>
    );
  }

  if (load.status === "error") {
    return (
      <div className="usage-error" role="alert">
        <p>{load.message}</p>
        <Button variant="ghost" onClick={props.onRetry}>
          Try again
        </Button>
      </div>
    );
  }

  const { contact } = load;
  const error = actionError ? (
    <p className="email-notices__error" role="alert">
      {actionError}
    </p>
  ) : null;

  if (!contact.available) {
    return (
      <div className="email-notices" data-state="unavailable">
        <p className="email-notices__note" role="status">
          Email notices aren&apos;t available on this deployment. Notices still reach you in the app, in
          the notification bell.
        </p>
        {contact.address ? (
          <>
            <AddressRow address={contact.address} chip={{ label: "Saved", tone: "neutral" }} />
            <div className="email-notices__actions">
              <Button variant="ghost" onClick={props.onRemove} disabled={busy !== null}>
                {busy === "removing" ? "Removing..." : "Remove address"}
              </Button>
            </div>
            {error}
          </>
        ) : null}
      </div>
    );
  }

  const intro = (
    <p className="email-notices__promise">
      <strong>{CONTACT_EMAIL_PROMISE}</strong> Every notice also stays in the app, whether or not you add
      an address. Your account doesn&apos;t need one: adding it links the address to your account, and so
      to your wallet, in our records only. It is never shown publicly or put on-chain, and removing it
      deletes it.
    </p>
  );

  if (contact.status === "none" || !contact.address) {
    return (
      <div className="email-notices" data-state="none">
        {intro}
        <AddressForm
          draft={props.draft}
          draftError={props.draftError}
          busy={busy}
          submitLabel="Send confirmation"
          allowCancel={false}
          onDraftChange={props.onDraftChange}
          onSubmit={props.onSubmit}
          onCancel={props.onCancelEditing}
        />
        <p className="email-notices__hint">
          We will email a link to confirm it. Nothing is sent to an address you have not confirmed.
        </p>
        {error}
      </div>
    );
  }

  if (contact.status === "disabled") {
    const reason = contact.disabledReason ? DISABLED_EXPLANATION[contact.disabledReason] : null;
    return (
      <div className="email-notices" data-state="disabled">
        {intro}
        <AddressRow address={contact.address} chip={{ label: "Stopped", tone: "warning" }} />
        <p className="email-notices__warning" role="status">
          {reason ?? "We stopped sending to this address."} Notices still reach you in the app.
        </p>
        <AddressForm
          draft={props.draft}
          draftError={props.draftError}
          busy={busy}
          submitLabel="Send confirmation"
          allowCancel={false}
          onDraftChange={props.onDraftChange}
          onSubmit={props.onSubmit}
          onCancel={props.onCancelEditing}
        />
        <div className="email-notices__actions">
          <Button variant="ghost" onClick={props.onRemove} disabled={busy !== null}>
            {busy === "removing" ? "Removing..." : "Remove address"}
          </Button>
        </div>
        {error}
      </div>
    );
  }

  const sentAt = formatConfirmationSent(contact.confirmationSentAt);
  const change = props.editing ? (
    <AddressForm
      draft={props.draft}
      draftError={props.draftError}
      busy={busy}
      submitLabel="Send confirmation"
      allowCancel
      onDraftChange={props.onDraftChange}
      onSubmit={props.onSubmit}
      onCancel={props.onCancelEditing}
    />
  ) : null;
  const changeHint = props.editing ? (
    <p className="email-notices__hint">
      A new address has to be confirmed. Until you do, notices reach you in the app only.
    </p>
  ) : null;

  if (contact.status === "pending") {
    return (
      <div className="email-notices" data-state="pending">
        {intro}
        <AddressRow address={contact.address} chip={{ label: "Waiting for confirmation", tone: "pending" }} />
        <p className="email-notices__note" role="status">
          <strong>Check your inbox.</strong> We sent a confirmation link
          {sentAt ? ` on ${sentAt}` : ""}. It works for 24 hours. Until you open it, nothing is emailed to
          you.
        </p>
        {props.editing ? null : (
          <div className="email-notices__actions">
            <Button onClick={props.onResend} disabled={busy !== null}>
              {busy === "resending" ? "Sending..." : "Resend confirmation"}
            </Button>
            <Button variant="ghost" onClick={props.onStartEditing} disabled={busy !== null}>
              Change address
            </Button>
            <Button variant="ghost" onClick={props.onRemove} disabled={busy !== null}>
              {busy === "removing" ? "Removing..." : "Remove"}
            </Button>
          </div>
        )}
        {change}
        {changeHint}
        {error}
      </div>
    );
  }

  return (
    <div className="email-notices" data-state="confirmed">
      {intro}
      <AddressRow address={contact.address} chip={{ label: "Confirmed", tone: "good" }} />
      {props.editing ? null : (
        <div className="email-notices__actions">
          <Button variant="ghost" onClick={props.onStartEditing} disabled={busy !== null}>
            Change address
          </Button>
          <Button variant="ghost" onClick={props.onRemove} disabled={busy !== null}>
            {busy === "removing" ? "Removing..." : "Remove"}
          </Button>
        </div>
      )}
      {change}
      {changeHint}

      <fieldset className="email-notices__categories" disabled={busy === "preferences"}>
        <legend>Which notices to email</legend>
        <p className="email-notices__hint">
          Switching one off only stops the email. You still see every notice in the app.
        </p>
        <ul className="email-notices__category-list">
          {contact.categories.map((entry) => {
            const id = `email-notices-${entry.category}`;
            return (
              <li key={entry.category} className="email-notices__category" data-required={entry.required}>
                <label className="email-notices__category-toggle" htmlFor={id}>
                  <input
                    id={id}
                    type="checkbox"
                    checked={entry.required ? true : entry.enabled}
                    disabled={entry.required}
                    aria-describedby={`${id}-copy`}
                    onChange={(event) => props.onToggleCategory(entry.category, event.target.checked)}
                  />
                  <span className="email-notices__category-name">
                    {NOTICE_CATEGORY_LABELS[entry.category]}
                    {entry.required ? <span className="email-notices__chip" data-tone="neutral">Required</span> : null}
                  </span>
                </label>
                <span id={`${id}-copy`} className="email-notices__category-copy">
                  {entry.required ? requiredReason(entry.category) : EMAIL_CATEGORY_DESCRIPTIONS[entry.category]}
                </span>
              </li>
            );
          })}
        </ul>
      </fieldset>
      {error}
    </div>
  );
}

/**
 * Settings → Email notices. Owns the requests and the dialog; the view above
 * owns the words. Success is a toast; a failure stays next to the controls so
 * it is still there after the toast is gone.
 */
export default function EmailNoticesPanel({ token, addToast }: Props) {
  const [load, setLoad] = useState<EmailNoticesLoad>({ status: "loading" });
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<EmailNoticesBusy>(null);
  const [editing, setEditing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const refresh = useCallback(async () => {
    if (!token) return;
    setLoad({ status: "loading" });
    try {
      setLoad({ status: "ready", contact: await getContactEmail(token) });
    } catch (error) {
      setLoad({ status: "error", message: describeContactEmailError(error) });
    }
  }, [token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const apply = (contact: ContactEmailState) => {
    setLoad({ status: "ready", contact });
    setEditing(false);
    setDraft("");
    setDraftError(null);
  };

  const submit = async () => {
    if (!token || busy) return;
    const problem = validateContactEmailInput(draft);
    setDraftError(problem);
    if (problem) return;
    setBusy("saving");
    setActionError(null);
    try {
      const contact = await setContactEmail(token, draft.trim());
      apply(contact);
      addToast({
        type: "success",
        title: contact.status === "confirmed" ? "Already confirmed" : "Check your inbox",
        message:
          contact.status === "confirmed"
            ? "That address is already confirmed."
            : "We sent a link to confirm your address.",
      });
    } catch (error) {
      setActionError(describeContactEmailError(error));
      // A failed send keeps the address pending on the server; show it so Resend works.
      void getContactEmail(token).then(
        (contact) => {
          if (contact.status !== "none") apply(contact);
        },
        () => undefined,
      );
    } finally {
      setBusy(null);
    }
  };

  const resend = async () => {
    if (!token || busy) return;
    setBusy("resending");
    setActionError(null);
    try {
      const result = await resendContactEmailConfirmation(token);
      setLoad({ status: "ready", contact: result ?? (await getContactEmail(token)) });
      addToast({ type: "success", title: "Confirmation sent", message: "Check your inbox for the new link." });
    } catch (error) {
      setActionError(describeContactEmailError(error));
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!token || busy) return;
    setConfirmRemove(false);
    setBusy("removing");
    setActionError(null);
    try {
      await removeContactEmail(token);
      await refresh();
      setEditing(false);
      setDraft("");
      addToast({ type: "success", title: "Address removed", message: "We will not email you any more." });
    } catch (error) {
      setActionError(describeContactEmailError(error));
    } finally {
      setBusy(null);
    }
  };

  const toggleCategory = async (category: PlatformNoticeCategory, enabled: boolean) => {
    if (!token || busy || load.status !== "ready") return;
    setBusy("preferences");
    setActionError(null);
    try {
      const contact = await setContactEmailPreferences(
        token,
        optOutsAfterToggle(load.contact.categories, category, enabled),
      );
      setLoad({ status: "ready", contact });
    } catch (error) {
      setActionError(describeContactEmailError(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <EmailNoticesView
        load={load}
        draft={draft}
        draftError={draftError}
        actionError={actionError}
        busy={busy}
        editing={editing}
        onDraftChange={(value) => {
          setDraft(value);
          setDraftError(null);
        }}
        onSubmit={() => void submit()}
        onStartEditing={() => {
          setEditing(true);
          setActionError(null);
        }}
        onCancelEditing={() => {
          setEditing(false);
          setDraft("");
          setDraftError(null);
        }}
        onResend={() => void resend()}
        onRemove={() => setConfirmRemove(true)}
        onToggleCategory={(category, enabled) => void toggleCategory(category, enabled)}
        onRetry={() => void refresh()}
      />
      <ConfirmDialog
        isOpen={confirmRemove}
        variant="warning"
        title="Remove your email address?"
        message="We will stop emailing you. Notices keep arriving in the app, and you can add an address again any time."
        confirmLabel="Remove address"
        cancelLabel="Keep it"
        onConfirm={() => void remove()}
        onCancel={() => setConfirmRemove(false)}
      />
    </>
  );
}
