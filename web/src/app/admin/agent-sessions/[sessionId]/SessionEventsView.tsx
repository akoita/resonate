"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import {
  CopyableValue,
  ReviewQueueHeader,
  ReviewQueuePage,
  ReviewQueueStatePanel,
} from "../../../../components/admin/review-queue/ReviewQueue";
import {
  agentEventLabel,
  coverageLines,
  eventDetails,
  eventIdentifiers,
} from "../../../../lib/adminAgentSessions";
import { formatDateTime, pluralize } from "../../../../lib/adminUsers";
import type { AdminAgentSessionEvent, AdminAgentSessionEvents } from "../../../../lib/api";

export type SessionEventsState =
  | { status: "loading" }
  | { status: "forbidden" }
  | { status: "not_found" }
  | { status: "invalid" }
  | { status: "error"; message: string }
  | { status: "ready"; session: AdminAgentSessionEvents };

export type SessionEventsViewProps = {
  state: SessionEventsState;
  onRetry: () => void;
};

function BackLink() {
  return (
    <Link href="/admin/agent-sessions" className="admin-users-back" prefetch={false}>
      &larr; Look up another session
    </Link>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function EventRow({ event }: { event: AdminAgentSessionEvent }) {
  const details = eventDetails(event);
  const identifiers = eventIdentifiers(event);
  const coverage = event.coverage ? coverageLines(event.coverage) : [];
  return (
    <tr>
      <td data-label="Time">{formatDateTime(event.occurredAt)}</td>
      <td data-label="Event">{agentEventLabel(event.eventName)}</td>
      <td data-label="Identifiers">
        {identifiers.length === 0 ? (
          <span className="admin-users-muted">None</span>
        ) : (
          <span className="admin-agent-ids">
            {identifiers.map((identifier) => (
              <span key={identifier.label}>
                {identifier.label} <code>{identifier.value}</code>
              </span>
            ))}
          </span>
        )}
      </td>
      <td data-label="Decision">
        {details.length === 0 && coverage.length === 0 && !event.redactedFields ? (
          <span className="admin-users-muted">No details recorded</span>
        ) : (
          <ul className="admin-agent-detail">
            {details.map((detail) => (
              <li key={detail}>{detail}</li>
            ))}
            {coverage.map((line) => (
              <li key={line} className="admin-agent-detail__coverage">{line}</li>
            ))}
            {event.redactedFields ? (
              <li className="admin-agent-redacted">
                Left out because it was not a plain code: {event.redactedFields.join(", ")}
              </li>
            ) : null}
          </ul>
        )}
      </td>
    </tr>
  );
}

function Ready({ session }: { session: AdminAgentSessionEvents }) {
  return (
    <ReviewQueuePage className="admin-users-page">
      <BackLink />
      <div className="admin-users-hero">
        <ReviewQueueHeader
          eyebrow="AI DJ session"
          title="Session events"
          description="What the DJ decided in this session, oldest first. Identifiers, decisions, counts and reason codes only; nothing the listener typed is shown."
        />
      </div>
      <section className="admin-users-section" aria-labelledby="admin-agent-session-facts">
        <h2 id="admin-agent-session-facts">Session</h2>
        <dl className="admin-users-facts">
          <Fact label="Session id">
            <CopyableValue value={session.sessionId} subject="session id" />
          </Fact>
          <Fact label="Listener">
            {session.userId ? (
              <Link href={`/admin/users/${encodeURIComponent(session.userId)}`} prefetch={false}>
                {session.userId.slice(0, 8)}
              </Link>
            ) : (
              <span className="admin-users-muted">Session record no longer exists</span>
            )}
          </Fact>
          <Fact label="Started">
            {session.startedAt ? formatDateTime(session.startedAt) : <span className="admin-users-muted">Unknown</span>}
          </Fact>
          <Fact label="Ended">
            {session.endedAt ? formatDateTime(session.endedAt) : <span className="admin-users-muted">Not ended</span>}
          </Fact>
          <Fact label="Events">{pluralize(session.eventCount, "event")}</Fact>
        </dl>
        <p className="admin-users-note">
          Opening this page is logged with who opened it and when. Events are kept for {session.retentionDays} days, the
          same as other analytics events, and are gone after that.
        </p>
      </section>
      <section className="admin-users-section" aria-labelledby="admin-agent-session-events">
        <h2 id="admin-agent-session-events">Events</h2>
        {session.truncated ? (
          <p className="admin-users-readonly" role="status">
            This session has more events than can be shown. The oldest {session.eventCount} are listed.
          </p>
        ) : null}
        {session.events.length === 0 ? (
          <p className="admin-users-note">No agent events were recorded for this session, or they have expired.</p>
        ) : (
          <div className="admin-users-results">
            <table className="admin-users-table admin-agent-events">
              <caption className="visually-hidden">Agent events of this session, oldest first</caption>
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Event</th>
                  <th scope="col">Identifiers</th>
                  <th scope="col">Decision</th>
                </tr>
              </thead>
              <tbody>
                {session.events.map((event) => (
                  <EventRow key={event.id} event={event} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </ReviewQueuePage>
  );
}

/**
 * #2259: one AI DJ session's raw agent events for an admin. Presentation only;
 * the page owns the data and the auth gate.
 */
export default function SessionEventsView({ state, onRetry }: SessionEventsViewProps) {
  if (state.status === "ready") return <Ready session={state.session} />;
  if (state.status === "loading") {
    return (
      <ReviewQueuePage className="admin-users-page">
        <BackLink />
        <section className="admin-users-results" aria-busy="true" aria-label="Session events">
          <p className="visually-hidden" role="status">Loading session events...</p>
          <div className="admin-users-skeleton" aria-hidden="true">
            <span /><span /><span /><span />
          </div>
        </section>
      </ReviewQueuePage>
    );
  }
  return (
    <ReviewQueuePage className="admin-users-page">
      <BackLink />
      {state.status === "forbidden" ? (
        <ReviewQueueStatePanel
          variant="forbidden"
          heading="Admins only"
          body="Your account does not have access to the agent events of a session."
        />
      ) : state.status === "not_found" ? (
        <ReviewQueueStatePanel
          variant="empty"
          heading="Session not found"
          body="There is no session with this id and no recorded events for it. The events may have expired, or the id may be wrong."
        />
      ) : state.status === "invalid" ? (
        <ReviewQueueStatePanel
          variant="error"
          heading="This is not a session id"
          body="A session id has letters, numbers, dashes, dots, colons or underscores only, and no spaces."
        />
      ) : (
        <ReviewQueueStatePanel
          variant="error"
          heading="These events could not be loaded"
          body={state.message}
          actionLabel="Try again"
          onAction={onRetry}
        />
      )}
    </ReviewQueuePage>
  );
}
