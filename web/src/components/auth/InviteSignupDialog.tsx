"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { checkInvitationCode, joinWaitlist, type InvitationCheck, type InvitationRole } from "../../lib/api";
import { describeInvitationCheck } from "../../lib/invitationCopy";
import styles from "./InviteSignupDialog.module.css";

type Props = {
  open: boolean;
  initialCode?: string;
  /** Shown above the form, e.g. why the dialog opened after a refused sign-in. */
  notice?: string;
  onClose: () => void;
  /** Start the passkey sign-up with a code the server accepted. */
  onCreateAccount: (code: string) => void;
};

/**
 * Sign-up during an invitation-only preview (#2662): check a code, create the
 * account with it, or join the waiting list. A native modal `<dialog>`: the
 * browser handles focus, Escape and the inert page.
 */
export default function InviteSignupDialog({ open, initialCode = "", notice, onClose, onCreateAccount }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const ids = useId();
  const [code, setCode] = useState(initialCode);
  const [check, setCheck] = useState<InvitationCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [kind, setKind] = useState<InvitationRole>("listener");
  const [consent, setConsent] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (open && initialCode) setCode(initialCode);
  }, [open, initialCode]);

  const submitCode = async (event: FormEvent) => {
    event.preventDefault();
    if (check?.status === "valid") {
      onCreateAccount(code.trim());
      return;
    }
    setChecking(true);
    setCodeError(null);
    try {
      setCheck(await checkInvitationCode(code.trim()));
    } catch (error) {
      setCheck(null);
      setCodeError(error instanceof Error ? error.message : "The code could not be checked. Please try again.");
    } finally {
      setChecking(false);
    }
  };

  const submitWaitlist = async (event: FormEvent) => {
    event.preventDefault();
    setJoining(true);
    setJoinError(null);
    try {
      await joinWaitlist({ email: email.trim(), kind, consent });
      setJoined(true);
    } catch (error) {
      setJoinError(error instanceof Error ? error.message : "Something went wrong. Please try again.");
    } finally {
      setJoining(false);
    }
  };

  const valid = check?.status === "valid";

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={`${ids}-title`}
      onClose={onClose}
    >
      <div className={styles.header}>
        <h2 id={`${ids}-title`} className={styles.title}>Create your account</h2>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close">×</button>
      </div>
      <p className={styles.lead}>
        {notice ?? "Resonate is open by invitation during the preview. Your account is protected by a passkey on this device: no password, nothing to install."}
      </p>

      <form className={styles.form} onSubmit={submitCode}>
        <label className={styles.label} htmlFor={`${ids}-code`}>Invitation code</label>
        <div className={styles.row}>
          <input
            id={`${ids}-code`}
            className={styles.input}
            value={code}
            onChange={(event) => { setCode(event.target.value); setCheck(null); }}
            placeholder="XXXX-XXXX-XXXX"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={64}
            required
            aria-describedby={`${ids}-code-status`}
          />
          <button type="submit" className={styles.button} disabled={checking || !code.trim()}>
            {valid ? "Create account" : checking ? "Checking…" : "Check code"}
          </button>
        </div>
        <p id={`${ids}-code-status`} className={`${styles.message} ${valid ? styles.ok : styles.problem}`} role="status">
          {check ? describeInvitationCheck(check) : codeError ?? ""}
        </p>
        <p className={`wallet-legal-links ${styles.legal}`}>
          By creating an account, you agree to the <Link href="/terms">Terms</Link> and acknowledge
          the <Link href="/privacy">Privacy Policy</Link> and <Link href="/refunds">Refund Policy</Link>.
        </p>
      </form>

      <hr className={styles.divider} />

      <h3 className={styles.subtitle}>No invitation yet?</h3>
      {joined ? (
        <p className={`${styles.message} ${styles.ok}`} role="status">
          You&rsquo;re on the waiting list. We&rsquo;ll write to you when there is room.
        </p>
      ) : (
        <form className={styles.form} onSubmit={submitWaitlist}>
          <label className={styles.label} htmlFor={`${ids}-email`}>Email address</label>
          <input
            id={`${ids}-email`}
            className={styles.input}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            maxLength={254}
            required
          />
          <fieldset className={styles.choices}>
            <legend>I&rsquo;m joining as</legend>
            <label><input type="radio" name={`${ids}-kind`} checked={kind === "listener"} onChange={() => setKind("listener")} /> A listener</label>
            <label><input type="radio" name={`${ids}-kind`} checked={kind === "artist"} onChange={() => setKind("artist")} /> An artist</label>
          </fieldset>
          <label className={styles.consent}>
            <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} required />
            <span>Write to me at this address about my invitation. I can ask for it to be removed at any time.</span>
          </label>
          <button type="submit" className={styles.secondary} disabled={joining || !consent || !email.trim()}>
            {joining ? "Joining…" : "Join the waiting list"}
          </button>
          {joinError ? <p className={`${styles.message} ${styles.problem}`} role="alert">{joinError}</p> : null}
        </form>
      )}
    </dialog>
  );
}
