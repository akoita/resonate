"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../components/auth/AuthProvider";
import { getArtistMe, getTrustTier, type TrustTier } from "../lib/api";

/**
 * Hook to fetch the authenticated artist's trust tier and stake requirement.
 * Returns { trustTier, loading, error, refetch }.
 */
export function useTrustTier() {
  const { token } = useAuth();
  const [trustTier, setTrustTier] = useState<TrustTier | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTier = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const artist = await getArtistMe(token);
      if (!artist) {
        setError("Artist profile not found");
        return;
      }
      const tier = await getTrustTier(artist.id, token);
      setTrustTier(tier);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchTier();
  }, [fetchTier]);

  return { trustTier, loading, error, refetch: fetchTier };
}
