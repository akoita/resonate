"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { claimWelcomeFunds, getWelcomeFunds, type WelcomeFundsStatus } from "../../lib/api";
import { formatWelcomeDollars, welcomeMoneyMessage } from "../../lib/walletPlainWords";
import { useAuth } from "../auth/AuthProvider";
import { useToast } from "../ui/Toast";

const SKIP_MESSAGES: Record<string, string> = {
  daily_limit: "Today's welcome money has all been handed out. Please try again tomorrow.",
  no_verified_wallet: "Sign out and sign in again, then try once more.",
  already_attempted: "Your welcome money is already on its way.",
};

/**
 * First visit to the Wallet (newcomer pass): what the test money is for, three
 * steps to try it, and a "Get my test money" button when the welcome top-up
 * has not arrived. Renders nothing where the deployment hands out no welcome
 * money (production).
 */
export default function WelcomeMoneyCard({ onFunded }: { onFunded?: () => void }) {
  const { token, sessionChecked } = useAuth();
  const { addToast } = useToast();
  const [welcome, setWelcome] = useState<WelcomeFundsStatus | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionChecked || !token) return;
    let cancelled = false;
    getWelcomeFunds(token)
      .then((status) => { if (!cancelled) setWelcome(status); })
      .catch(() => { if (!cancelled) setWelcome(null); });
    return () => { cancelled = true; };
  }, [sessionChecked, token]);

  const claim = useCallback(async () => {
    if (!token) return;
    setClaiming(true);
    setNote(null);
    try {
      const { result, welcome: next } = await claimWelcomeFunds(token);
      setWelcome(next);
      if (result.status === "sent") {
        addToast({
          type: "success",
          visual: "funding",
          title: "Your test money is on its way",
          message: welcomeMoneyMessage(result),
          duration: 9000,
        });
        // The network needs a few seconds to settle the transfer.
        window.setTimeout(() => onFunded?.(), 6000);
      } else if (result.status === "failed") {
        setNote("That didn't work this time. Please try again in a few minutes.");
      } else {
        setNote(SKIP_MESSAGES[result.reason] ?? "There's nothing to add right now.");
      }
    } catch {
      setNote("That didn't work this time. Please try again in a few minutes.");
    } finally {
      setClaiming(false);
    }
  }, [addToast, onFunded, token]);

  if (!welcome?.available) return null;

  const dollars = welcome.amountUsdc ? formatWelcomeDollars(welcome.amountUsdc) : null;
  const received = welcome.usdc === "sent" || (!welcome.amountUsdc && welcome.eth === "sent");

  return (
    <section className="vault-card vault-welcome-card" aria-labelledby="wallet-welcome-title" data-testid="wallet-welcome-card">
      <div className="vault-card-header">
        <h2 className="vault-card-title" id="wallet-welcome-title">Start here</h2>
      </div>
      <p className="vault-welcome-lead">
        {received
          ? `Welcome! We added ${dollars ?? "test money"} to your wallet so you can try everything for free.`
          : `Every new account gets ${dollars ?? "test money"} to try Resonate for free.`}
      </p>
      <ol className="vault-welcome-steps">
        <li>
          <strong>Find a show you&apos;d go to.</strong> <Link href="/shows">Browse shows</Link>
        </li>
        <li>
          <strong>Back it with a few test dollars.</strong> The artist sees that fans are ready.
        </li>
        <li>
          <strong>If the show doesn&apos;t happen, you get it back.</strong> Nothing is ever taken for good.
        </li>
      </ol>
      {welcome.canClaim ? (
        <div className="vault-welcome-claim">
          <button
            type="button"
            className="vault-btn vault-btn--primary"
            onClick={claim}
            disabled={claiming}
            data-testid="wallet-claim-welcome"
          >
            {claiming ? "Adding…" : "Get my test money"}
          </button>
          {note ? <p className="vault-welcome-note" role="status">{note}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
