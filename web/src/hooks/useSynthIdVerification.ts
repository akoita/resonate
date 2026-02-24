"use client";

import { useState, useCallback } from 'react';

interface SynthIdResult {
  isAiGenerated: boolean;
  confidence: number;
  provider?: string;
}

interface UseSynthIdVerificationReturn {
  /** Whether verification is in progress */
  isLoading: boolean;
  /** Verification result */
  result: SynthIdResult | null;
  /** Error message if any */
  error: string | null;
  /** Verify a stem by its ID */
  verify: (stemId: string) => Promise<SynthIdResult | null>;
  /** Verify an uploaded audio file */
  verifyFile: (file: File) => Promise<SynthIdResult | null>;
  /** Reset the verification state */
  reset: () => void;
}

/**
 * Hook for verifying SynthID watermarks in audio content.
 *
 * Supports two modes:
 * - Verify by stem ID (for existing stems in the system)
 * - Verify by file upload (for new audio files)
 */
export function useSynthIdVerification(token?: string | null): UseSynthIdVerificationReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<SynthIdResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

  const verify = useCallback(async (stemId: string): Promise<SynthIdResult | null> => {
    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch(`${backendUrl}/api/generation/synthid/verify/${stemId}`, {
        method: 'POST',
        headers: {
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
      });

      if (!response.ok) {
        throw new Error(`Verification failed: ${response.status}`);
      }

      const data = await response.json();

      if (!data.available) {
        setError('SynthID verification is not available');
        return null;
      }

      const synthResult: SynthIdResult = {
        isAiGenerated: data.result.isAiGenerated,
        confidence: data.result.confidence,
        provider: data.result.provider,
      };

      setResult(synthResult);
      return synthResult;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Verification failed';
      setError(message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [backendUrl, token]);

  const verifyFile = useCallback(async (file: File): Promise<SynthIdResult | null> => {
    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append('audio', file);

      const response = await fetch(`${backendUrl}/api/generation/synthid/verify`, {
        method: 'POST',
        headers: {
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Verification failed: ${response.status}`);
      }

      const data = await response.json();

      if (!data.available) {
        setError('SynthID verification is not available');
        return null;
      }

      const synthResult: SynthIdResult = {
        isAiGenerated: data.result.isAiGenerated,
        confidence: data.result.confidence,
        provider: data.result.provider,
      };

      setResult(synthResult);
      return synthResult;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Verification failed';
      setError(message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [backendUrl, token]);

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
    setIsLoading(false);
  }, []);

  return {
    isLoading,
    result,
    error,
    verify,
    verifyFile,
    reset,
  };
}
