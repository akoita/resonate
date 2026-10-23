import { hasFilters } from "../../lib/agentSessionRequest";
import type { AgentNextPreferences, AgentSessionRequest } from "../../lib/api";
import type { SessionPreset } from "./sessionPresetData";

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
 * derived from it. A typed sentence also travels as `requestText`, with the
 * artists it named (#2241), so the DJ can search by its meaning for this
 * session only; a starter's canned sentence does not.
 */
export function buildSessionPreferences({
    activePreset,
    request,
    sentence,
    artists = [],
}: {
    activePreset: SessionPreset | null;
    request: AgentSessionRequest | null;
    /** The typed sentence the chips were read from, still in force (#2241). */
    sentence?: string | null;
    /** Catalog artists named in that sentence and not removed (#2241). */
    artists?: readonly string[];
}): AgentNextPreferences | undefined {
    if (activePreset) {
        if (!request) return toIntentPreferences(activePreset);
        // The Adjust row can change the starter's energy (or clear it): the request wins, so the
        // session never carries two different energies.
        return { ...toIntentPreferences(activePreset), request, energy: request.energy ?? undefined };
    }
    const text = sentence?.trim();
    const sentenceFields = {
        ...(text ? { requestText: text } : {}),
        ...(artists.length > 0 ? { artists: [...artists] } : {}),
    };
    if (!request || !hasFilters(request)) {
        // A sentence the chips did not capture ("something for cooking", "like <Artist>") still steers.
        return Object.keys(sentenceFields).length > 0
            ? { ...sentenceFields, source: "agent_session_prompt" }
            : undefined;
    }
    return {
        ...sentenceFields,
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
    sentence,
    artists,
}: {
    activePreset: SessionPreset | null;
    request: AgentSessionRequest | null;
    savedVibes?: string[];
    sentence?: string | null;
    artists?: readonly string[];
}): AgentNextPreferences {
    const built = buildSessionPreferences({ activePreset, request, sentence, artists });
    // The server remembers a live session's earlier preferences when a key is omitted, so a sentence
    // or artists the listener has since dropped are cleared explicitly (empty values).
    const sentenceReset = { requestText: "", artists: [] as string[] };
    if (built && (built.request || built.sessionIntent)) return { ...sentenceReset, ...built };
    // No chips: the saved vibes are where the session starts, plus any sentence.
    return {
        genres: savedVibes,
        ...(request ? { request } : {}),
        ...sentenceReset,
        ...(built ?? {}),
    };
}
