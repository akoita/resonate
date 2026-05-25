"use client";

import { useCallback, useEffect, useState } from "react";
import AuthGate from "../../../components/auth/AuthGate";
import { useAuth } from "../../../components/auth/AuthProvider";
import ArtistAnalyticsDashboard from "../../../components/analytics/ArtistAnalyticsDashboard";
import StakingOverview from "../../../components/analytics/StakingOverview";
import {
  getArtistAnalyticsDashboard,
  getArtistMe,
  type ArtistAnalyticsDashboard as ArtistAnalyticsDashboardData,
  type ArtistProfile,
} from "../../../lib/api";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; artist: ArtistProfile; data: ArtistAnalyticsDashboardData }
  | { status: "no-artist" }
  | { status: "error"; message: string };

export default function ArtistAnalyticsPage() {
  const { token } = useAuth();
  const [days, setDays] = useState(30);
  const [state, setState] = useState<LoadState>({ status: "loading" });

  const load = useCallback(async () => {
    if (!token) {
      return;
    }

    setState({ status: "loading" });
    try {
      const artist = await getArtistMe(token);
      if (!artist) {
        setState({ status: "no-artist" });
        return;
      }

      const data = await getArtistAnalyticsDashboard(token, artist.id, days);
      setState({ status: "ready", artist, data });
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Unable to load analytics.",
      });
    }
  }, [days, token]);

  useEffect(() => {
    let cancelled = false;

    async function loadIfActive() {
      if (!token) {
        return;
      }
      setState({ status: "loading" });
      try {
        const artist = await getArtistMe(token);
        if (cancelled) return;
        if (!artist) {
          setState({ status: "no-artist" });
          return;
        }

        const data = await getArtistAnalyticsDashboard(token, artist.id, days);
        if (!cancelled) {
          setState({ status: "ready", artist, data });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Unable to load analytics.",
          });
        }
      }
    }

    void loadIfActive();
    return () => {
      cancelled = true;
    };
  }, [days, token]);

  return (
    <AuthGate title="Connect your wallet to view artist analytics.">
      {state.status === "loading" ? (
        <ArtistAnalyticsDashboard status="loading" days={days} onDaysChange={setDays} />
      ) : null}
      {state.status === "error" ? (
        <ArtistAnalyticsDashboard
          status="error"
          days={days}
          message={state.message}
          onRetry={load}
          onDaysChange={setDays}
        />
      ) : null}
      {state.status === "no-artist" ? (
        <ArtistAnalyticsDashboard status="no-artist" days={days} onDaysChange={setDays} />
      ) : null}
      {state.status === "ready" ? (
        <>
          <ArtistAnalyticsDashboard
            status="ready"
            days={days}
            artistName={state.artist.displayName}
            data={state.data}
            onDaysChange={setDays}
          />
          <StakingOverview />
        </>
      ) : null}
    </AuthGate>
  );
}
