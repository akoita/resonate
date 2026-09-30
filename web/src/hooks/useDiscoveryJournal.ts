"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../components/auth/AuthProvider";
import { getDiscoveryJournal, type DiscoveryJournal } from "../lib/api";

export function useDiscoveryJournal() {
    const { status, token } = useAuth();
    const [journal, setJournal] = useState<DiscoveryJournal | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchJournal = useCallback(async () => {
        if (status !== "authenticated" || !token) return;
        setIsLoading(true);
        setError(null);
        try {
            setJournal(await getDiscoveryJournal(token));
        } catch {
            // Keep any journal already shown; surface a quiet retry message.
            setError("We could not load your discoveries. Try again in a moment.");
        } finally {
            setIsLoading(false);
        }
    }, [status, token]);

    useEffect(() => {
        fetchJournal();
    }, [fetchJournal]);

    return { journal, isLoading, error, refetch: fetchJournal };
}
