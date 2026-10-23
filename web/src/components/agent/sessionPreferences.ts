import { hasFilters } from "../../lib/agentSessionRequest";
import type { AgentNextPreferences, AgentSessionRequest } from "../../lib/api";
import type { SessionPreset } from "./AgentSessionPresets";

export function toIntentPreferences(preset: SessionPreset): AgentNextPreferences {
    return {
        ...preset.preferences,
        genres: preset.searchVibes,
        sessionIntent: preset.intent,
        sessionIntentName: preset.name,
        queueStyle: preset.queueStyle,
        source: "agent_session_intent",
    };
}

/**
 * The preferences a session start (or a pick request) carries for the current
 * filters, or undefined when there is nothing to steer: a plain start.
 *
 * An untouched preset keeps its exact preferences and adds its request. Typed or
 * edited filters travel as the request plus the session genres, mood and energy
 * derived from it. The typed sentence is never part of the preferences.
 */
export function buildSessionPreferences({
    activePreset,
    request,
}: {
    activePreset: SessionPreset | null;
    request: AgentSessionRequest | null;
}): AgentNextPreferences | undefined {
    if (activePreset) {
        return request
            ? { ...toIntentPreferences(activePreset), request }
            : toIntentPreferences(activePreset);
    }
    if (!request || !hasFilters(request)) return undefined;
    return {
        request,
        // Never the saved vibes: a request naming a mood (or energy) but no genre
        // searches every genre, ranked by learned taste and the mood. The saved
        // vibes only steer a session with no filters at all (the caller's own
        // fallback, and the backend's plain start).
        genres: request.genres,
        mood: request.moods[0],
        energy: request.energy ?? undefined,
        source: "agent_session_prompt",
    };
}

/**
 * The preferences a next-pick request carries (also what the continuation reuses
 * to keep a set going).
 *
 * With filters or a preset this is `buildSessionPreferences`. With no filters at
 * all the DJ starts from the saved vibes, as a plain session start does; a
 * request whose chips were all removed still travels (empty) so the DJ drops the
 * session's earlier filters, because omitting the key would keep them.
 */
export function buildPickPreferences({
    activePreset,
    request,
    savedVibes,
}: {
    activePreset: SessionPreset | null;
    request: AgentSessionRequest | null;
    savedVibes?: string[];
}): AgentNextPreferences {
    return (
        buildSessionPreferences({ activePreset, request }) ?? {
            genres: savedVibes,
            ...(request ? { request } : {}),
        }
    );
}
