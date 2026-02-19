"use client";

import { useState, useCallback, useRef } from "react";
import { createGeneration, getGenerationStatus } from "../lib/api";
import { useWebSockets, GenerationStatusUpdate, GenerationProgressUpdate } from "./useWebSockets";

export type GenerationState =
  | "idle"
  | "submitting"
  | "queued"
  | "generating"
  | "storing"
  | "complete"
  | "failed";

export interface GenerationResult {
  trackId: string;
  releaseId: string;
}

export function useGeneration(token: string | null, artistId: string | null) {
  const [state, setState] = useState<GenerationState>("idle");
  const [jobId, setJobId] = useState<string | null>(null);
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeJobRef = useRef<string | null>(null);

  const handleGenerationStatus = useCallback((data: GenerationStatusUpdate) => {
    if (activeJobRef.current && data.jobId === activeJobRef.current) {
      if (data.trackId && data.releaseId) {
        setResult({ trackId: data.trackId, releaseId: data.releaseId });
        setState("complete");
      } else if (data.error) {
        setError(data.error);
        setState("failed");
      }
    }
  }, []);

  const handleGenerationProgress = useCallback((data: GenerationProgressUpdate) => {
    if (activeJobRef.current && data.jobId === activeJobRef.current) {
      setState(data.phase === "generating" ? "generating" : "storing");
    }
  }, []);

  useWebSockets(
    undefined, // onStatusUpdate
    undefined, // onProgressUpdate
    undefined, // onTrackStatusUpdate
    undefined, // onMarketplaceUpdate
    handleGenerationStatus,
    handleGenerationProgress
  );

  const startGeneration = useCallback(
    async (prompt: string, options?: { negativePrompt?: string; seed?: number }) => {
      if (!token || !artistId) {
        setError("Please connect your wallet and set up an artist profile first.");
        setState("failed");
        return;
      }

      setState("submitting");
      setResult(null);
      setError(null);

      try {
        const res = await createGeneration(token, {
          prompt,
          artistId,
          negativePrompt: options?.negativePrompt,
          seed: options?.seed,
        });
        setJobId(res.jobId);
        activeJobRef.current = res.jobId;
        setState("queued");

        // Poll for status in case WebSocket misses
        const pollInterval = setInterval(async () => {
          try {
            const status = await getGenerationStatus(token, res.jobId);
            if (status.status === "complete" && status.trackId && status.releaseId) {
              setResult({ trackId: status.trackId, releaseId: status.releaseId });
              setState("complete");
              clearInterval(pollInterval);
            } else if (status.status === "failed") {
              setError(status.error || "Generation failed");
              setState("failed");
              clearInterval(pollInterval);
            } else if (status.status === "generating" || status.status === "storing") {
              setState(status.status);
            }
          } catch {
            // Ignore polling errors
          }
        }, 3000);

        // Stop polling after 5 minutes
        setTimeout(() => clearInterval(pollInterval), 5 * 60 * 1000);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to start generation";
        setError(message);
        setState("failed");
      }
    },
    [token, artistId]
  );

  const reset = useCallback(() => {
    setState("idle");
    setJobId(null);
    setResult(null);
    setError(null);
    activeJobRef.current = null;
  }, []);

  return {
    state,
    jobId,
    result,
    error,
    startGeneration,
    reset,
  };
}
