"use client";

import { useSyncExternalStore } from "react";
import type { AgentEvent } from "../../hooks/useAgentEvents";

/** True for `?debug=agent`. */
export function isAgentDebugRequested(search: string): boolean {
    return new URLSearchParams(search).get("debug") === "agent";
}

const subscribeNever = () => () => {};
const readDebugFlag = () => isAgentDebugRequested(window.location.search);

type Props = {
    events: readonly AgentEvent[];
    /** Overrides the URL check; tests and storybook-style callers only. */
    enabled?: boolean;
};

/**
 * The raw agent event stream, for people debugging their own DJ session. It is
 * hidden unless the page is opened with `?debug=agent`: listeners get the
 * request coverage line and the pick reasons instead (#2238). Events reach only
 * the signed-in session owner's socket, so this shows the viewer's own events.
 */
export default function AgentEventsDebug({ events, enabled }: Props) {
    // The server render and hydration see "not requested"; the client then reads the URL.
    const requested = useSyncExternalStore(subscribeNever, readDebugFlag, () => false);

    if (!(enabled ?? requested)) return null;
    return (
        <details className="aid-taste-hint" data-testid="agent-events-debug">
            <summary>Agent events (debug)</summary>
            {events.length === 0 ? (
                <p>No events yet in this tab.</p>
            ) : (
                <ol>
                    {events.map((event) => (
                        <li key={event.id}>
                            <code>{event.type}</code> {event.message}
                            {event.timestamp ? ` (${event.timestamp})` : ""}
                        </li>
                    ))}
                </ol>
            )}
        </details>
    );
}
