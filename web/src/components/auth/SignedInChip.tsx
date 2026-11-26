"use client";

import Link from "next/link";
import { useAuth } from "./AuthProvider";
import { AUTH_COPY } from "../../lib/authCopy";
import { useAccountName } from "../../hooks/useAccountName";
import { useProductSurfaces } from "../../hooks/useProductSurfaces";

/** What the chip says until (or unless) the person has a name on Resonate. */
export const ACCOUNT_CHIP_FALLBACK = "Your account";

/**
 * The signed-in chip in the top bar: who is signed in, a way to their account,
 * and Sign out. It names the person, never the address behind their passkey
 * account; the address stays on the screens about the account itself.
 */
export default function SignedInChip({ onSignOut }: { onSignOut: () => void }) {
  const { token, status } = useAuth();
  const { surfaces } = useProductSurfaces();
  const name = useAccountName(token, status === "authenticated");
  const label = name ?? ACCOUNT_CHIP_FALLBACK;
  const initial = name ? name[0]!.toUpperCase() : null;
  const accountHref = surfaces.wallet ? "/wallet" : "/settings";

  return (
    <div className="wallet-connected">
      <Link
        href={accountHref}
        prefetch={false}
        className="wallet-connected-info wallet-account-link"
        aria-label={`${name ? `Signed in as ${name}` : "Signed in"}. Open your account.`}
        title="Your account"
      >
        <span className="wallet-avatar" aria-hidden="true">
          {initial ?? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
            </svg>
          )}
        </span>
        <span className="wallet-address">
          <span className="wallet-address-text">{label}</span>
        </span>
      </Link>
      <button
        type="button"
        className="wallet-disconnect"
        onClick={onSignOut}
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
