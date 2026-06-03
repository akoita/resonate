"use client";

import { useCallback, useEffect, useState } from "react";
import AuthGate from "../../../../components/auth/AuthGate";
import { useAuth } from "../../../../components/auth/AuthProvider";
import CommunityCohortOperationsPanel from "../../../../components/admin/CommunityCohortOperationsPanel";
import {
  generateCommunityCohorts,
  getCommunityCohortQuality,
  type CommunityCohortGenerationResponse,
  type CommunityCohortQualityResponse,
} from "../../../../lib/api";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; data: CommunityCohortQualityResponse }
  | { status: "forbidden" }
  | { status: "error"; message: string };

export default function CommunityCohortAdminPage() {
  const { token, role } = useAuth();
  const [minimumSize, setMinimumSize] = useState(2);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [lastGeneration, setLastGeneration] = useState<CommunityCohortGenerationResponse | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const canRead = role === "admin";

  const load = useCallback(async () => {
    if (!token) {
      return;
    }
    if (!canRead) {
      setState({ status: "forbidden" });
      return;
    }

    setState({ status: "loading" });
    try {
      const data = await getCommunityCohortQuality(token);
      setState({ status: "ready", data });
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Unable to load community cohort health.",
      });
    }
  }, [canRead, token]);

  useEffect(() => {
    let cancelled = false;

    async function loadIfActive() {
      if (!token) {
        return;
      }
      if (!canRead) {
        setState({ status: "forbidden" });
        return;
      }

      setState({ status: "loading" });
      try {
        const data = await getCommunityCohortQuality(token);
        if (!cancelled) {
          setState({ status: "ready", data });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Unable to load community cohort health.",
          });
        }
      }
    }

    void loadIfActive();
    return () => {
      cancelled = true;
    };
  }, [canRead, token]);

  const handleGenerate = useCallback(async () => {
    if (!token || !canRead) {
      setState({ status: "forbidden" });
      return;
    }

    setIsGenerating(true);
    setGenerateError(null);
    try {
      const generation = await generateCommunityCohorts(token, { minimumSize });
      const quality = await getCommunityCohortQuality(token);
      setLastGeneration(generation);
      setState({ status: "ready", data: quality });
    } catch (error) {
      setGenerateError(error instanceof Error ? error.message : "Unable to generate community cohorts.");
    } finally {
      setIsGenerating(false);
    }
  }, [canRead, minimumSize, token]);

  const handleMinimumSizeChange = useCallback((value: number) => {
    setMinimumSize(Math.min(100, Math.max(2, Math.floor(value))));
  }, []);

  return (
    <AuthGate title="Connect your wallet to manage community cohorts.">
      {state.status === "loading" ? (
        <CommunityCohortOperationsPanel
          status="loading"
          minimumSize={minimumSize}
          onMinimumSizeChange={handleMinimumSizeChange}
        />
      ) : null}
      {state.status === "forbidden" ? (
        <CommunityCohortOperationsPanel
          status="forbidden"
          minimumSize={minimumSize}
          onMinimumSizeChange={handleMinimumSizeChange}
        />
      ) : null}
      {state.status === "error" ? (
        <CommunityCohortOperationsPanel
          status="error"
          minimumSize={minimumSize}
          message={state.message}
          onMinimumSizeChange={handleMinimumSizeChange}
          onRefresh={load}
        />
      ) : null}
      {state.status === "ready" ? (
        <CommunityCohortOperationsPanel
          status="ready"
          minimumSize={minimumSize}
          quality={state.data}
          lastGeneration={lastGeneration}
          isGenerating={isGenerating}
          generateError={generateError}
          onMinimumSizeChange={handleMinimumSizeChange}
          onGenerate={handleGenerate}
          onRefresh={load}
        />
      ) : null}
    </AuthGate>
  );
}
