"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../components/auth/AuthProvider";
import {
    enableAgentWallet,
    disableAgentWallet,
    getAgentWalletStatus,
    getAgentTransactions,
    type AgentWalletStatus,
    type AgentTransaction,
} from "../lib/api";

export function useAgentWallet() {
    const { status: authStatus, token } = useAuth();
    const [walletStatus, setWalletStatus] = useState<AgentWalletStatus | null>(null);
    const [transactions, setTransactions] = useState<AgentTransaction[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isEnabling, setIsEnabling] = useState(false);
    const [isDisabling, setIsDisabling] = useState(false);

    const fetchStatus = useCallback(async () => {
        if (authStatus !== "authenticated" || !token) return;
        try {
            const result = await getAgentWalletStatus(token);
            setWalletStatus(result);
        } catch {
            setWalletStatus(null);
        } finally {
            setIsLoading(false);
        }
    }, [authStatus, token]);

    const fetchTransactions = useCallback(async () => {
        if (authStatus !== "authenticated" || !token) return;
        try {
            const result = await getAgentTransactions(token);
            setTransactions(result);
        } catch {
            setTransactions([]);
        }
    }, [authStatus, token]);

    useEffect(() => {
        fetchStatus();
        fetchTransactions();
    }, [fetchStatus, fetchTransactions]);

    const enable = useCallback(async () => {
        if (!token) return;
        setIsEnabling(true);
        try {
            const result = await enableAgentWallet(token);
            setWalletStatus(result);
            return result;
        } finally {
            setIsEnabling(false);
        }
    }, [token]);

    const disable = useCallback(async () => {
        if (!token) return;
        setIsDisabling(true);
        try {
            await disableAgentWallet(token);
            await fetchStatus();
        } finally {
            setIsDisabling(false);
        }
    }, [token, fetchStatus]);

    return {
        walletStatus,
        transactions,
        isLoading,
        isEnabling,
        isDisabling,
        enable,
        disable,
        refetchStatus: fetchStatus,
        refetchTransactions: fetchTransactions,
    };
}
