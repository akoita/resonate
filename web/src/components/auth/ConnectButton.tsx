"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useAuth } from "./AuthProvider";
import { AUTH_COPY } from "../../lib/authCopy";
import InviteSignupDialog from "./InviteSignupDialog";
import { getRegistrationStatus } from "../../lib/api";
import { readRememberedInvite, rememberInviteFromUrl } from "../../lib/invitationCopy";
import SignedInChip, { ACCOUNT_CHIP_FALLBACK } from "./SignedInChip";

function sessionStorageOrNull(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

const subscribe = () => () => { };

export default function ConnectButton() {
  const { status, sessionChecked, address, login, signup, disconnect, error, errorCode } = useAuth();
  const hasMounted = useSyncExternalStore(subscribe, () => true, () => false);
  // #2662: invitation-only sign-up. The dialog opens from Create account when the
  // server is in invitation mode, from an `?invite=` link, or after a sign-in
  // that needed a code.
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteCode, setInviteCode] = useState("");

  useEffect(() => {
    if (!sessionChecked || status === "authenticated") return;
    const fromUrl = rememberInviteFromUrl(window.location.search, sessionStorageOrNull());
    if (fromUrl) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInviteCode(fromUrl);
      setInviteOpen(true);
    }
  }, [sessionChecked, status]);

  // #2663 follow-up: on phones the three-line legal note made the signed-out top
  // bar 150px tall. When sign-up goes through the invitation dialog, the dialog
  // carries the same note next to the button that creates the account, so the
  // bar can drop it on small screens.
  const [registrationMode, setRegistrationMode] = useState<string | null>(null);
  useEffect(() => {
    if (!sessionChecked || status === "authenticated") return;
    let cancelled = false;
    getRegistrationStatus()
      .then((registration) => { if (!cancelled) setRegistrationMode(registration.mode); })
      .catch(() => { /* keep the note in the bar */ });
    return () => { cancelled = true; };
  }, [sessionChecked, status]);

  const startSignup = async () => {
    try {
      const registration = await getRegistrationStatus();
      if (registration.mode === "invite") {
        setInviteCode(readRememberedInvite(sessionStorageOrNull()));
        setInviteOpen(true);
        return;
      }
    } catch {
      // If the mode cannot be read, try the plain sign-up; the server still decides.
    }
    await signup();
  };

  const createWithCode = (code: string) => {
    setInviteOpen(false);
    void signup(code);
  };

  if (hasMounted && status === "authenticated" && address) {
    return <SignedInChip onSignOut={disconnect} />;
  }

  // Until the stored session has been read (server render, and the first
  // client render before hydration effects run) nobody knows whether this
  // visitor is signed in. The sign-in block is twice the height of the signed-in
  // chip, so showing it to a returning listener made the top bar shrink, and
  // the whole page jump up 57px and be drawn again, as soon as the session
  // restored. The root layout's inline script marks <html data-session="stored">
  // before first paint when a session is stored; CSS (globals.css) then shows
  // this empty chip-sized frame in place of the sign-in block. A signed-out
  // visitor has no mark and sees the sign-in block from the first paint.
  const sessionPending = !hasMounted || !sessionChecked;

  return (
    <>
      {sessionPending ? (
        <div className="wallet-connected wallet-connected--pending" aria-hidden="true">
          <div className="wallet-connected-info">
            <span className="wallet-avatar" />
            <span className="wallet-address">
              <span className="wallet-address-text">{ACCOUNT_CHIP_FALLBACK}</span>
            </span>
          </div>
          <button type="button" className="wallet-disconnect" tabIndex={-1}>
            <svg width="16" height="16" viewBox="0 0 24 24" />
          </button>
        </div>
      ) : null}
    <div className="wallet-connect" data-session-pending={sessionPending ? "" : undefined}>
      <div className="wallet-connect-actions">
        <button
          className="wallet-connect-btn login"
          onClick={login}
          disabled={status === "loading"}
        >
          <span className="wallet-connect-btn-glow" />
          <span className="wallet-connect-btn-content">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
              <polyline points="10 17 15 12 10 7" />
              <line x1="15" y1="12" x2="3" y2="12" />
            </svg>
            {status === "loading" ? "..." : AUTH_COPY.signIn}
          </span>
        </button>

        <button
          className="wallet-connect-btn signup"
          onClick={() => void startSignup()}
          disabled={status === "loading"}
        >
          <span className="wallet-connect-btn-glow" />
          <span className="wallet-connect-btn-content">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="8.5" cy="7" r="4" />
              <line x1="20" y1="8" x2="20" y2="14" />
              <line x1="23" y1="11" x2="17" y2="11" />
            </svg>
            {status === "loading" ? "..." : AUTH_COPY.createAccount}
          </span>
        </button>
      </div>

      <p className={`wallet-legal-links${registrationMode === "invite" ? " wallet-legal-links--in-dialog" : ""}`}>
        By creating an account, you agree to the <Link href="/terms">Terms</Link> and acknowledge
        the <Link href="/privacy">Privacy Policy</Link> and <Link href="/refunds">Refund Policy</Link>.
      </p>

      {status === "error" && error ? (
        <div className="wallet-error">
          {error}
          {errorCode?.startsWith("invite_") ? (
            <>
              {" "}
              <button type="button" className="wallet-error-action" onClick={() => setInviteOpen(true)}>
                Enter an invitation code
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
    <InviteSignupDialog
      open={inviteOpen}
      initialCode={inviteCode}
      onClose={() => setInviteOpen(false)}
      onCreateAccount={createWithCode}
    />
    </>
  );
}
