"use client";

import { useCallback, useState } from "react";
import { testDollarFaucet } from "../../lib/walletPlainWords";
import { useZeroDev } from "../auth/ZeroDevProviderClient";
import { useToast } from "../ui/Toast";

/**
 * Self-serve test dollars: on a test network, anyone can top their wallet up
 * from Circle's public test-USDC faucet. We only link to it and copy the
 * address; nothing here signs or moves money.
 */
export default function FreeTestDollarsCard({ address, onRefresh }: { address: string | null; onRefresh: () => void }) {
  const { chainId } = useZeroDev();
  const { addToast } = useToast();
  const [copied, setCopied] = useState(false);
  const faucet = testDollarFaucet(chainId);

  const copy = useCallback(async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      addToast({ type: "error", title: "Couldn't copy", message: "Select the address and copy it by hand." });
    }
  }, [address, addToast]);

  if (!faucet || !address) return null;

  return (
    <section className="vault-card vault-welcome-card" aria-labelledby="wallet-free-dollars-title" data-testid="wallet-free-dollars-card">
      <div className="vault-card-header">
        <h2 className="vault-card-title" id="wallet-free-dollars-title">Get more test dollars, free</h2>
      </div>
      <p className="vault-welcome-lead">
        Need more? Circle, the company behind the USDC dollar, gives out free test dollars every couple of hours.
      </p>
      <ol className="vault-welcome-steps">
        <li>
          <strong>Copy your wallet address.</strong>{" "}
          <button type="button" className="vault-btn vault-btn--ghost vault-btn--sm" onClick={copy} data-testid="wallet-copy-address">
            {copied ? "Copied" : "Copy address"}
          </button>
          <code className="vault-free-dollars-address">{address}</code>
        </li>
        <li>
          <strong>Open Circle&apos;s test faucet.</strong>{" "}
          <a href={faucet.url} target="_blank" rel="noopener noreferrer" data-testid="wallet-faucet-link">
            Open faucet.circle.com
          </a>
        </li>
        <li>
          <strong>Pick USDC, then the {faucet.networkName} network.</strong> Paste your address under &quot;Send to&quot; and press Send.
        </li>
        <li>
          <strong>Come back and refresh.</strong> The dollars arrive within a minute.{" "}
          <button type="button" className="vault-btn vault-btn--ghost vault-btn--sm" onClick={onRefresh}>
            Refresh balance
          </button>
        </li>
      </ol>
    </section>
  );
}
