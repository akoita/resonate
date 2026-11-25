"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { getContactEmail, setContactEmail } from "../../lib/api";
import { CONTACT_EMAIL_MAX_LENGTH, describeContactEmailError, validateContactEmailInput } from "../../lib/contactEmail";
import { dismissEmailPrompt } from "../../lib/emailPrompt";
import { clearSignupEmailPrompt, hasSignupEmailPrompt } from "../../lib/signupEmailPrompt";
import { useAuth } from "./AuthProvider";
import styles from "./InviteSignupDialog.module.css";

/**
 * #2665: once, right after a new account is created, offer to add an email
 * address. Optional; it goes through the usual confirmation link, and nothing
 * else is sent until the address is confirmed.
 */
export default function SignupEmailPrompt() {
  const { token, status, userId } = useAuth();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const ids = useId();
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (status !== "authenticated" || !token || !hasSignupEmailPrompt()) return;
    let cancelled = false;
    getContactEmail(token)
      .then((state) => {
        if (cancelled) return;
        if (state.available && state.status === "none") setOpen(true);
        else clearSignupEmailPrompt();
      })
      .catch(() => {
        if (!cancelled) clearSignupEmailPrompt();
      });
    return () => {
      cancelled = true;
    };
  }, [status, token]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const close = () => {
    clearSignupEmailPrompt();
    // Asked once at sign-up: the Home onboarding card does not ask again.
    if (userId) dismissEmailPrompt(userId, "onboarding");
    setOpen(false);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!token) return;
    const problem = validateContactEmailInput(address);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await setContactEmail(token, address.trim());
      clearSignupEmailPrompt();
      setSent(true);
    } catch (err) {
      setError(describeContactEmailError(err));
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <dialog ref={dialogRef} className={styles.dialog} aria-labelledby={`${ids}-title`} onClose={close}>
      <div className={styles.header}>
        <h2 id={`${ids}-title`} className={styles.title}>Add an email address?</h2>
        <button type="button" className={styles.close} onClick={close} aria-label="Close">×</button>
      </div>
      {sent ? (
        <>
          <p className={`${styles.message} ${styles.ok}`} role="status">
            Check your inbox for a confirmation link. Nothing else is sent until you confirm it.
          </p>
          <button type="button" className={styles.button} onClick={close}>Done</button>
        </>
      ) : (
        <>
          <p className={styles.lead}>
            Optional. We use it only to reach you about your account and your music, such as a release going live or a
            notice about something you uploaded. Never for marketing.
          </p>
          <form className={styles.form} onSubmit={submit}>
            <label className={styles.label} htmlFor={`${ids}-email`}>Email address</label>
            <input
              id={`${ids}-email`}
              className={styles.input}
              type="email"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              autoComplete="email"
              maxLength={CONTACT_EMAIL_MAX_LENGTH}
              required
              aria-describedby={`${ids}-status`}
            />
            <p id={`${ids}-status`} className={`${styles.message} ${styles.problem}`} role="status">{error ?? ""}</p>
            <div className={styles.row}>
              <button type="submit" className={styles.button} disabled={saving || !address.trim()}>
                {saving ? "Sending…" : "Send confirmation link"}
              </button>
              <button type="button" className={styles.secondary} onClick={close} disabled={saving}>
                Skip for now
              </button>
            </div>
          </form>
        </>
      )}
    </dialog>
  );
}
