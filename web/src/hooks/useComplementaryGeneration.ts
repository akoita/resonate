"use client";

import { useState, useCallback, useRef } from "react";
import {
  analyzeTrackStems,
  generateComplementaryStem,
  getGenerationStatus,
  StemAnalysisResult,
} from "../lib/api";
import {
  useWebSockets,
  GenerationStatusUpdate,
  GenerationProgressUpdate,
} from "./useWebSockets";

export type ComplementaryState =
  | "idle"
  | "analyzing"
  | "ready"
  | "generating"
  | "complete"
  | "failed";

export interface ComplementaryGeneration {
  /** Stem analysis result (available when state is "ready" or later) */
  analysis: StemAnalysisResult | null;
  /** Current state of the hook */
  state: ComplementaryState;
  /** Which stem type is currently being generated (null if none) */
  generatingStemType: string | null;
  /** Error message if something failed */
  error: string | null;
  /** Analyze the stems of a track */
  analyze: (trackId: string) => Promise<void>;
  /** Generate a missing stem */
  generateStem: (stemType: string) => Promise<void>;
  /** Reset the hook state */
  reset: () => void;
}

export function useComplementaryGeneration(
  token: string | null
): ComplementaryGeneration {
  const [analysis, setAnalysis] = useState<StemAnalysisResult | null>(null);
  const [state, setState] = useState<ComplementaryState>("idle");
  const [generatingStemType, setGeneratingStemType] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeJobRef = useRef<string | null>(null);

  // Listen for WebSocket generation events
  const handleGenerationStatus = useCallback(
    (data: GenerationStatusUpdate) => {
      if (activeJobRef.current && data.jobId === activeJobRef.current) {
        if (data.trackId && data.releaseId) {
          setState("complete");
          setGeneratingStemType(null);
          activeJobRef.current = null;
        } else if (data.error) {
          setError(data.error);
          setState("failed");
          setGeneratingStemType(null);
          activeJobRef.current = null;
        }
      }
    },
    []
  );

  const handleGenerationProgress = useCallback(
    (data: GenerationProgressUpdate) => {
      if (activeJobRef.current && data.jobId === activeJobRef.current) {
        setState("generating");
      }
    },
    []
  );

  useWebSockets(
    undefined,
    undefined,
    undefined,
    undefined,
    handleGenerationStatus,
    handleGenerationProgress
  );

  const analyze = useCallback(
    async (trackId: string) => {
      if (!token) return;
      setState("analyzing");
      setError(null);
      try {
        const result = await analyzeTrackStems(token, trackId);
        setAnalysis(result);
        setState("ready");
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to analyze stems");
        setState("failed");
      }
    },
    [token]
  );

  const generateStem = useCallback(
    async (stemType: string) => {
      if (!token || !analysis) return;
      setState("generating");
      setGeneratingStemType(stemType);
      setError(null);

      try {
        const res = await generateComplementaryStem(
          token,
          analysis.trackId,
          stemType
        );
        activeJobRef.current = res.jobId;

        // Poll as fallback in case WebSocket misses
        const pollInterval = setInterval(async () => {
          try {
            const status = await getGenerationStatus(token, res.jobId);
            if (status.status === "complete") {
              setState("complete");
              setGeneratingStemType(null);
              activeJobRef.current = null;
              clearInterval(pollInterval);
            } else if (status.status === "failed") {
              setError(status.error || "Generation failed");
              setState("failed");
              setGeneratingStemType(null);
              activeJobRef.current = null;
              clearInterval(pollInterval);
            }
          } catch {
            // Ignore polling errors
          }
        }, 3000);

        setTimeout(() => clearInterval(pollInterval), 5 * 60 * 1000);
      } catch (err: unknown) {
        setError(
          err instanceof Error ? err.message : "Failed to start generation"
        );
        setState("failed");
        setGeneratingStemType(null);
      }
    },
    [token, analysis]
  );

  const reset = useCallback(() => {
    setAnalysis(null);
    setState("idle");
    setGeneratingStemType(null);
    setError(null);
    activeJobRef.current = null;
  }, []);

  return {
    analysis,
    state,
    generatingStemType,
    error,
    analyze,
    generateStem,
    reset,
  };
}
