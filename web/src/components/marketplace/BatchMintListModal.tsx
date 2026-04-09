"use client";

import { useState, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  useBatchMintAndList,
  type BatchStemItem,
  type BatchStemResult,
  type BatchStemStatus,
} from "../../hooks/useContracts";

interface BatchMintListModalProps {
  stems: BatchStemItem[];
  onClose: () => void;
  onComplete?: () => void;
}

const STEM_EMOJI: Record<string, string> = {
  vocals: "🎤",
  drums: "🥁",
  bass: "🎸",
  piano: "🎹",
  guitar: "🎸",
  other: "🎵",
};

const STATUS_ICON: Record<BatchStemStatus, string> = {
  pending: "⏳",
  processing: "🔄",
  done: "✅",
  failed: "❌",
};

export function BatchMintListModal({ stems, onClose, onComplete }: BatchMintListModalProps) {
  const { executeBatch, pending } = useBatchMintAndList();
  const [phase, setPhase] = useState<"confirm" | "progress">("confirm");
  const [results, setResults] = useState<BatchStemResult[]>([]);
  const [batchError, setBatchError] = useState<string | null>(null);

  const handleConfirm = useCallback(async () => {
    setBatchError(null);
    setPhase("progress");
    try {
      await executeBatch(stems, {
        onProgress: (r) => setResults([...r]),
      });
      onComplete?.();
      onClose();
    } catch (err) {
      setBatchError(
        err instanceof Error ? err.message : "Batch transaction failed"
      );
    }
  }, [stems, executeBatch, onClose, onComplete]);

  const handleRetryFailed = useCallback(async () => {
    const failedStems = stems.filter(s =>
      results.find(r => r.stemId === s.stemId && r.status === "failed")
    );
    if (failedStems.length === 0) return;

    setBatchError(null);
    try {
      await executeBatch(failedStems, {
        onProgress: (newResults) => {
          setResults(prev => {
            const updated = [...prev];
            for (const nr of newResults) {
              const idx = updated.findIndex(r => r.stemId === nr.stemId);
              if (idx !== -1) updated[idx] = nr;
            }
            return updated;
          });
        },
      });
      onComplete?.();
      onClose();
    } catch (err) {
      setBatchError(
        err instanceof Error ? err.message : "Retry failed"
      );
    }
  }, [stems, results, executeBatch, onClose, onComplete]);

  const doneCount = results.filter(r => r.status === "done").length;
  const failedCount = results.filter(r => r.status === "failed").length;
  const allDone = results.length > 0 && results.every(r => r.status === "done");

  return createPortal(
    <>
      {/* Backdrop */}
      <div className="batch-modal-backdrop" onClick={onClose} />

      <div className="batch-modal">
        {/* Header */}
        <div className="batch-modal-header">
          <h3 className="batch-modal-title">
            {phase === "confirm" ? "Batch Mint & List" : "Processing Batch"}
          </h3>
          <button className="batch-modal-close" onClick={onClose}>✕</button>
        </div>

        {/* Confirm Phase */}
        {phase === "confirm" && (
          <>
            <p className="batch-modal-desc">
              The following <strong>{stems.length} stems</strong> will be minted as NFTs and listed on the marketplace at <strong>0.01 ETH</strong> each.
            </p>

            <div className="batch-stems-list">
              {stems.map(stem => (
                <div key={stem.stemId} className="batch-stem-row">
                  <span className="batch-stem-emoji">
                    {STEM_EMOJI[stem.stemType] || "🎵"}
                  </span>
                  <div className="batch-stem-info">
                    <span className="batch-stem-type">
                      {stem.stemType.charAt(0).toUpperCase() + stem.stemType.slice(1)}
                    </span>
                    <span className="batch-stem-track">{stem.trackTitle}</span>
                  </div>
                  <span className="batch-stem-price">0.01 ETH</span>
                </div>
              ))}
            </div>

            <div className="batch-modal-footer">
              <button className="batch-btn-cancel" onClick={onClose}>
                Cancel
              </button>
              <button
                className="batch-btn-confirm"
                onClick={handleConfirm}
                disabled={pending}
              >
                {pending ? "Starting..." : `Confirm All (${stems.length})`}
              </button>
            </div>
          </>
        )}

        {/* Progress Phase */}
        {phase === "progress" && (
          <>
            {/* Progress bar */}
            <div className="batch-progress-bar-container">
              <div
                className="batch-progress-bar"
                style={{ width: `${results.length > 0 ? (doneCount / results.length) * 100 : 0}%` }}
              />
            </div>
            <p className="batch-progress-text">
              {allDone
                ? `All ${stems.length} stems minted & listed!`
                : pending
                  ? `Processing ${stems.length} stems... (one passkey prompt)`
                  : failedCount > 0
                    ? `${doneCount} succeeded, ${failedCount} failed`
                    : `${doneCount} of ${stems.length} complete`}
            </p>

            <div className="batch-stems-list">
              {results.map(result => {
                const stem = stems.find(s => s.stemId === result.stemId);
                return (
                  <div
                    key={result.stemId}
                    className={`batch-stem-row batch-status-${result.status}`}
                  >
                    <span className="batch-stem-emoji">
                      {STEM_EMOJI[stem?.stemType || "other"] || "🎵"}
                    </span>
                    <div className="batch-stem-info">
                      <span className="batch-stem-type">
                        {stem?.stemType
                          ? stem.stemType.charAt(0).toUpperCase() + stem.stemType.slice(1)
                          : "Unknown"}
                      </span>
                      <span className="batch-stem-track">{stem?.trackTitle || ""}</span>
                    </div>
                    <span className="batch-stem-status">
                      {STATUS_ICON[result.status]}
                      {result.status === "done" && result.tokenId != null && (
                        <span className="batch-token-id"> #{result.tokenId.toString()}</span>
                      )}
                      {result.status === "failed" && (
                        <span className="batch-error-hint"> Failed</span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>

            {batchError && (
              <div className="batch-error-banner">
                {batchError}
              </div>
            )}

            <div className="batch-modal-footer">
              {failedCount > 0 && !pending && (
                <button className="batch-btn-retry" onClick={handleRetryFailed}>
                  Retry Failed ({failedCount})
                </button>
              )}
              <button
                className="batch-btn-close"
                onClick={onClose}
                disabled={pending}
              >
                {pending ? "Processing..." : "Close"}
              </button>
            </div>
          </>
        )}
      </div>

      <style jsx global>{`
        .batch-modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.7);
          backdrop-filter: blur(4px);
          z-index: 1000;
          animation: fadeIn 0.15s ease;
        }

        .batch-modal {
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          z-index: 1001;
          background: #18181b;
          border: 1px solid #3f3f46;
          border-radius: 20px;
          width: 90%;
          max-width: 520px;
          max-height: 80vh;
          overflow-y: auto;
          padding: 28px;
          box-shadow: 0 40px 80px rgba(0, 0, 0, 0.5);
          animation: slideUp 0.2s ease;
        }

        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes slideUp {
          from {
            opacity: 0;
            transform: translate(-50%, -46%);
          }
          to {
            opacity: 1;
            transform: translate(-50%, -50%);
          }
        }

        .batch-modal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 16px;
        }

        .batch-modal-title {
          font-size: 20px;
          font-weight: 800;
          color: #fff;
          margin: 0;
        }

        .batch-modal-close {
          background: transparent;
          border: none;
          color: #71717a;
          font-size: 18px;
          cursor: pointer;
          padding: 4px 8px;
          border-radius: 6px;
          transition: all 0.15s;
        }

        .batch-modal-close:hover {
          background: #27272a;
          color: #fff;
        }

        .batch-modal-desc {
          font-size: 14px;
          color: #a1a1aa;
          line-height: 1.5;
          margin: 0 0 20px;
        }

        .batch-stems-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
          margin-bottom: 20px;
          max-height: 320px;
          overflow-y: auto;
          scrollbar-width: thin;
          scrollbar-color: rgba(255, 255, 255, 0.15) transparent;
        }

        .batch-stem-row {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 14px;
          background: #27272a;
          border-radius: 10px;
          border: 1px solid #3f3f46;
          transition: all 0.2s;
        }

        .batch-status-done {
          border-color: #10b981;
          background: rgba(16, 185, 129, 0.08);
        }

        .batch-status-failed {
          border-color: #ef4444;
          background: rgba(239, 68, 68, 0.08);
        }

        .batch-status-processing {
          border-color: #8b5cf6;
          background: rgba(139, 92, 246, 0.08);
          animation: pulse 1.5s ease infinite;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }

        .batch-stem-emoji {
          font-size: 18px;
          flex-shrink: 0;
        }

        .batch-stem-info {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
        }

        .batch-stem-type {
          font-size: 14px;
          font-weight: 600;
          color: #fff;
        }

        .batch-stem-track {
          font-size: 12px;
          color: #71717a;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .batch-stem-price {
          font-size: 13px;
          font-weight: 600;
          color: #8b5cf6;
          flex-shrink: 0;
        }

        .batch-stem-status {
          font-size: 14px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .batch-token-id {
          font-size: 11px;
          color: #71717a;
        }

        .batch-error-hint {
          font-size: 12px;
          color: #f87171;
        }

        .batch-progress-bar-container {
          width: 100%;
          height: 6px;
          background: #27272a;
          border-radius: 3px;
          margin-bottom: 12px;
          overflow: hidden;
        }

        .batch-progress-bar {
          height: 100%;
          background: linear-gradient(90deg, #8b5cf6, #10b981);
          border-radius: 3px;
          transition: width 0.4s ease;
        }

        .batch-progress-text {
          font-size: 13px;
          color: #a1a1aa;
          margin: 0 0 16px;
          text-align: center;
        }

        .batch-error-banner {
          padding: 10px 14px;
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.3);
          border-radius: 10px;
          color: #f87171;
          font-size: 13px;
          margin-bottom: 16px;
          word-break: break-word;
        }

        .batch-modal-footer {
          display: flex;
          gap: 12px;
          justify-content: flex-end;
        }

        .batch-btn-cancel {
          padding: 10px 24px;
          background: transparent;
          border: 1px solid #3f3f46;
          border-radius: 10px;
          color: #a1a1aa;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s;
        }

        .batch-btn-cancel:hover {
          background: #27272a;
          color: #fff;
        }

        .batch-btn-confirm {
          padding: 10px 28px;
          background: #8b5cf6;
          border: none;
          border-radius: 10px;
          color: #fff;
          font-size: 14px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.15s;
        }

        .batch-btn-confirm:hover:not(:disabled) {
          background: #7c3aed;
        }

        .batch-btn-confirm:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .batch-btn-retry {
          padding: 10px 24px;
          background: rgba(239, 68, 68, 0.15);
          border: 1px solid rgba(239, 68, 68, 0.4);
          border-radius: 10px;
          color: #f87171;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s;
        }

        .batch-btn-retry:hover {
          background: rgba(239, 68, 68, 0.25);
        }

        .batch-btn-close {
          padding: 10px 28px;
          background: #27272a;
          border: 1px solid #3f3f46;
          border-radius: 10px;
          color: #fff;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s;
        }

        .batch-btn-close:hover:not(:disabled) {
          background: #3f3f46;
        }

        .batch-btn-close:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
      `}</style>
    </>,
    document.body
  );
}
