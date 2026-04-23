"use client";

import { Button } from "../ui/Button";
import { summarizeProcessingFailure } from "./processingFailure";

type ProcessingFailureCalloutProps = {
  error: string;
  canRetry: boolean;
  onRetry: () => void;
  onViewDiagnostics: () => void;
};

export function ProcessingFailureCallout({
  error,
  canRetry,
  onRetry,
  onViewDiagnostics,
}: ProcessingFailureCalloutProps) {
  const failure = summarizeProcessingFailure(error);

  return (
    <section className={`processing-failure-callout processing-failure-callout--${failure.tone}`} aria-live="polite">
      <div className="processing-failure-callout__content">
        <div className="processing-failure-callout__eyebrow">
          <span aria-hidden className="processing-failure-callout__dot" />
          {failure.severityLabel}
        </div>
        <h2 className="processing-failure-callout__title">{failure.title}</h2>
        <p className="processing-failure-callout__body">{failure.message}</p>
        <p className="processing-failure-callout__recovery">{failure.recovery}</p>
      </div>

      <div className="processing-failure-callout__actions">
        {canRetry && (
          <Button className="processing-failure-callout__retry" onClick={onRetry}>
            Retry Processing
          </Button>
        )}
        <Button variant="ghost" className="processing-failure-callout__diagnostics" onClick={onViewDiagnostics}>
          View Diagnostics
        </Button>
      </div>

      <style jsx>{`
        .processing-failure-callout {
          --failure-accent: #fb7185;
          --failure-accent-soft: rgba(251, 113, 133, 0.12);
          --failure-border: rgba(248, 113, 113, 0.24);
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          flex-wrap: wrap;
          margin-bottom: var(--space-4);
          padding: 16px;
          border-radius: 18px;
          border: 1px solid var(--failure-border);
          color: #fecaca;
          background:
            linear-gradient(135deg, rgba(127, 29, 29, 0.22), rgba(24, 24, 32, 0.92) 54%, rgba(88, 28, 135, 0.14));
          box-shadow: 0 18px 60px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.04);
        }

        .processing-failure-callout--warning {
          --failure-accent: #fbbf24;
          --failure-accent-soft: rgba(251, 191, 36, 0.12);
          --failure-border: rgba(251, 191, 36, 0.22);
          background:
            linear-gradient(135deg, rgba(120, 53, 15, 0.22), rgba(24, 24, 32, 0.92) 54%, rgba(88, 28, 135, 0.12));
          color: #fde68a;
        }

        .processing-failure-callout__content {
          min-width: 240px;
          flex: 1 1 420px;
        }

        .processing-failure-callout__eyebrow {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 10px;
          border-radius: 999px;
          border: 1px solid var(--failure-border);
          background: var(--failure-accent-soft);
          padding: 5px 10px;
          color: var(--failure-accent);
          font-size: 0.68rem;
          font-weight: 800;
          letter-spacing: 0.09em;
          text-transform: uppercase;
        }

        .processing-failure-callout__dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: var(--failure-accent);
          box-shadow: 0 0 18px var(--failure-accent);
        }

        .processing-failure-callout__title {
          margin: 0 0 6px;
          color: #fff;
          font-size: 1.05rem;
          line-height: 1.25;
        }

        .processing-failure-callout__body,
        .processing-failure-callout__recovery {
          max-width: 760px;
          line-height: 1.55;
        }

        .processing-failure-callout__body {
          margin: 0;
          color: rgba(255, 255, 255, 0.84);
          font-size: 0.92rem;
        }

        .processing-failure-callout__recovery {
          margin: 10px 0 0;
          color: rgba(255, 255, 255, 0.64);
          font-size: 0.82rem;
        }

        .processing-failure-callout__actions {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          justify-content: flex-end;
          flex: 0 0 auto;
        }

        :global(.processing-failure-callout__retry) {
          background-color: rgba(239, 68, 68, 0.92) !important;
          color: white !important;
          border-color: transparent !important;
        }

        .processing-failure-callout--warning :global(.processing-failure-callout__retry) {
          background-color: rgba(245, 158, 11, 0.92) !important;
        }

        :global(.processing-failure-callout__diagnostics) {
          border-color: rgba(255,255,255,0.16) !important;
          color: rgba(255,255,255,0.82) !important;
        }

        @media (max-width: 720px) {
          .processing-failure-callout {
            padding: 14px;
          }

          .processing-failure-callout__actions {
            width: 100%;
            justify-content: stretch;
          }

          .processing-failure-callout__actions :global(button) {
            flex: 1 1 100%;
          }
        }
      `}</style>
    </section>
  );
}
