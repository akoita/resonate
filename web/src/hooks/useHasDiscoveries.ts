"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../components/auth/AuthProvider";
import { getDiscoveryJournal } from "../lib/api";
import { runWhenSettledAndIdle } from "../lib/pageSettle";
import { journalHasDiscoveries, readStoredHasDiscoveries, storeHasDiscoveries } from "../lib/sonicRadarNav";

// One journal read per page load and account; client-side navigation reuses it.
let checkedFor: string | null = null;

/**
 * Whether the signed-in listener's Sonic Radar has anything in it. Starts from
 * the answer stored for this account in the tab, then asks the journal once
 * the page has settled, so the check never competes with the page load.
 * `enabled` must be false during server rendering (it reads sessionStorage).
 */
export function useHasDiscoveries(enabled: boolean): boolean {
  const { status, token, address, smartAccountAddress } = useAuth();
  const account = enabled && status === "authenticated" && token ? (smartAccountAddress ?? address ?? null) : null;
  const [fetched, setFetched] = useState<{ account: string; has: boolean } | null>(null);
  const stored = useMemo(() => readStoredHasDiscoveries(account), [account]);

  useEffect(() => {
    if (!account || !token || checkedFor === account) return;
    let cancelled = false;
    const cancel = runWhenSettledAndIdle(() => {
      getDiscoveryJournal(token, { limit: 1 })
        .then((journal) => {
          const has = journalHasDiscoveries(journal);
          checkedFor = account;
          storeHasDiscoveries(account, has);
          if (!cancelled) setFetched({ account, has });
        })
        .catch(() => undefined);
    });
    return () => {
      cancelled = true;
      cancel();
    };
  }, [account, token]);

  if (!account) return false;
  return fetched?.account === account ? fetched.has : stored;
}
