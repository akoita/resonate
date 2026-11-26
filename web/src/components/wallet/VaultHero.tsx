"use client";

import { useEffect } from "react";
import { WalletRecord } from "../../lib/api";
import {
    hasSeenFundingAnnouncement,
    markFundingAnnouncementSeen,
    shouldAnnounceExceptionalFunding,
} from "../../lib/fundingAnnouncement";
import { isPaymasterEnabled } from "../../lib/bundlerConfig";
import {
    dollarBalance,
    feesLine,
    formatDollars,
    isTestMoneyChain,
    welcomeMoneyMessage,
} from "../../lib/walletPlainWords";
import { useOnChainBalance } from "../../hooks/useOnChainBalance";
import { usePaymentAssetBalances, usePaymentAssets } from "../../hooks/usePaymentAssets";
import { useZeroDev } from "../auth/ZeroDevProviderClient";
import { useToast } from "../ui/Toast";

type VaultHeroProps = {
    wallet: WalletRecord | null;
    status: string;
    address: string | null;
    isDeployed: boolean;
    onRefresh: () => void;
    /** Bumped after welcome money arrives so the balance reads again. */
    refreshKey?: number;
};

/**
 * The Wallet page's first screen in plain words: one balance in dollars, a
 * "Test money" badge on test networks, and a line about fees. Addresses and
 * account technicalities live under "Technical details" further down.
 */
export default function VaultHero({ address, onRefresh, refreshKey = 0 }: VaultHeroProps) {
    const { addToast } = useToast();
    const { chainId } = useZeroDev();
    const { balance, balanceEth, loading: ethLoading } = useOnChainBalance(address);
    const { assets } = usePaymentAssets(chainId);
    const stablecoins = assets.filter((asset) => asset.kind === "stablecoin" && asset.enabled);
    const { balances, loading: dollarsLoading } = usePaymentAssetBalances({
        wallet: address,
        assets: stablecoins,
        refreshKey,
    });

    const testMoney = isTestMoneyChain(chainId);
    const ethValue = balanceEth ? Number(balanceEth) : null;
    const dollars = dollarBalance(balances);
    const fees = feesLine({ sponsored: isPaymasterEnabled(chainId), ethBalance: ethValue });
    const loading = dollarsLoading || (stablecoins.length === 0 && ethLoading);

    useEffect(() => {
        if (!address || !chainId || ethLoading) return;
        if (!shouldAnnounceExceptionalFunding(chainId, balance)) return;
        if (hasSeenFundingAnnouncement(address, chainId)) return;

        markFundingAnnouncementSeen(address, chainId);
        addToast({
            type: "success",
            visual: "funding",
            title: "Test money arrived",
            message: welcomeMoneyMessage({ amountEth: balanceEth }),
            duration: 9000,
        });
    }, [addToast, address, balance, balanceEth, ethLoading, chainId]);

    return (
        <div className="vault-hero">
            <div className="vault-hero-mesh" />

            <div className="vault-hero-content">
                <div className="vault-hero-top-row">
                    {testMoney ? (
                        <div className="vault-network-badge vault-test-money-badge" data-testid="wallet-test-money-badge">
                            <span className="vault-network-dot" />
                            Test money
                        </div>
                    ) : <span />}
                    <button className="vault-btn vault-btn--ghost vault-btn--sm" onClick={onRefresh}>
                        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="23 4 23 10 17 10" />
                            <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
                        </svg>
                        Refresh
                    </button>
                </div>

                <div className="vault-balance-group">
                    <h1 className="vault-balance-label">Your balance</h1>
                    <div className="vault-balance" data-testid="wallet-dollar-balance">
                        {loading ? (
                            <span className="vault-balance-skeleton">Loading…</span>
                        ) : (
                            formatDollars(dollars)
                        )}
                    </div>
                    {fees ? <div className="vault-balance-usd">{fees}</div> : null}
                    {testMoney ? (
                        <p className="vault-hero-note">
                            This is test money on a practice network. It has no real value, so try anything:
                            back a show, then get it back if the show doesn&apos;t happen.
                        </p>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
