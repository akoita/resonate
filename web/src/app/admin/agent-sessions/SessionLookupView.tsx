"use client";

import type { FormEvent } from "react";
import {
  ReviewQueueHeader,
  ReviewQueuePage,
  ReviewQueueStatePanel,
} from "../../../components/admin/review-queue/ReviewQueue";
import { Button } from "../../../components/ui/Button";

export type SessionLookupViewProps = {
  /** Admins only; the server enforces the same rule. */
  allowed: boolean;
  value: string;
  error: string | null;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
};

/**
 * #2259: where an admin enters the id of an AI DJ session to see its raw agent
 * events. Presentation only; the page owns navigation and the auth gate.
 */
export default function SessionLookupView({ allowed, value, error, onValueChange, onSubmit }: SessionLookupViewProps) {
  if (!allowed) {
    return (
      <ReviewQueuePage className="admin-users-page">
        <ReviewQueueStatePanel
          variant="forbidden"
          heading="Admins only"
          body="Your account does not have access to the agent events of a session."
        />
      </ReviewQueuePage>
    );
  }
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };
  return (
    <ReviewQueuePage className="admin-users-page">
      <ReviewQueueHeader
        eyebrow="AI DJ"
        title="Session events"
        description="Look up one AI DJ session by its id to see, in order, what the DJ decided: the picks, why each was chosen, and how well they matched what the listener asked for."
      />
      <section className="admin-users-filters" aria-label="Find a session">
        <form className="admin-agent-lookup" onSubmit={submit} role="search">
          <label className="admin-users-field">
            <span>Session id</span>
            <input
              type="search"
              value={value}
              maxLength={200}
              autoComplete="off"
              spellCheck={false}
              placeholder="Session id"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "admin-agent-lookup-error" : undefined}
              onChange={(event) => onValueChange(event.target.value)}
            />
          </label>
          <Button type="submit" variant="primary">Show events</Button>
        </form>
        {error ? <p id="admin-agent-lookup-error" className="admin-users-error" role="alert">{error}</p> : null}
        <p className="admin-users-note">
          Opening a session is logged with who opened it and when. The events show identifiers, decisions, counts and
          reason codes, never what the listener typed. They are kept for as long as analytics events are.
        </p>
      </section>
    </ReviewQueuePage>
  );
}
