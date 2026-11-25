"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useAuth } from "./AuthProvider";
import { AUTH_COPY } from "../../lib/authCopy";
import InviteSignupDialog from "./InviteSignupDialog";
import { getRegistrationStatus } from "../../lib/api";
import { readRememberedInvite, rememberInviteFromUrl } from "../../lib/invitationCopy";

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
  const [copied, setCopied] = useState(false);
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

  const copyAddress = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      console.warn("[Auth] Clipboard permission denied while copying wallet address.");
    }
  };

  if (hasMounted && status === "authenticated" && address) {
    return (
      <div className="wallet-connected">
        <div className="wallet-connected-info">
          <div className="wallet-avatar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2z" />
              <path d="M16 11.37a4 4 0 1 1-4.73-4.73 4 4 0 0 1 4.73 4.73z" />
            </svg>
          </div>
          <button className="wallet-address" onClick={copyAddress} title="Click to copy">
            <span className="wallet-address-text">
              {address.slice(0, 6)}…{address.slice(-4)}
            </span>
            <span className="wallet-copy-icon">
              {copied ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              )}
            </span>
          </button>
        </div>
        <button
          type="button"
          className="wallet-disconnect"
          onClick={disconnect}
          aria-label={AUTH_COPY.signOut}
          title={AUTH_COPY.signOut}
        >
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </button>
      </div>
    );
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
            <div className="wallet-avatar" />
            <button type="button" className="wallet-address" tabIndex={-1}>
              <span className="wallet-address-text">0x0000…0000</span>
              <span className="wallet-copy-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" />
              </span>
            </button>
          </div>
          <button type="button" className="wallet-disconnect" tabIndex={-1}>
            <svg width="16" height="16" viewBox="0 0 24 24" />
          </button>
        </div>
      ) : null}
    <div className="wallet-connect" data-session-pending={sessionPending ? "" : undefined}>
      <div className="wallet-connect-label">Secure Access</div>
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

      <p className="wallet-legal-links">
        <span>By creating an account, you agree to the</span>
        <Link href="/terms">Terms</Link>
        <span>and acknowledge the</span>
        <Link href="/privacy">Privacy Policy</Link>
        <span>and</span>
        <Link href="/refunds">Refund Policy</Link>
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
