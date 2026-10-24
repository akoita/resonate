import { hasFilters } from "../../lib/agentSessionRequest";
import type { AgentDiscoveryLevel, AgentNextPreferences, AgentSessionRequest } from "../../lib/api";
import type { DjSeed } from "../../lib/djSeed";
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
    seed = null,
    fillSimilar,
    newArtists,
    discovery,
}: {
    activePreset: SessionPreset | null;
    request: AgentSessionRequest | null;
    /** The typed sentence the chips were read from, still in force (#2241). */
    sentence?: string | null;
    /** Catalog artists named in that sentence and not removed (#2241). */
    artists?: readonly string[];
    /** What the session starts from (#2244); it rides along with any filters and stays for the session. */
    seed?: DjSeed | null;
    /**
     * "Fill with similar sounds" (#2316). Sent only when on: off is the server's
     * default, so a session that never touched it is exactly what it was.
     */
    fillSimilar?: boolean;
    /**
     * "New artists only" (#2249). Sent only when on: off is the server's default.
     * It rides with whatever else the session carries (a Sounds starter, a sentence).
     */
    newArtists?: boolean;
    /**
     * The Discovery control (#2327). A start sends it only when it is not the default: "mixed"
     * is the server's default, so a session that never touched it is exactly what it was.
     */
    discovery?: AgentDiscoveryLevel;
}): AgentNextPreferences | undefined {
    const built = buildSessionPreferencesBase({ activePreset, request, sentence, artists, seed });
    const withFill = built && fillSimilar === true ? { ...built, fillSimilar: true } : built;
    const withNew = newArtists === true ? { ...(withFill ?? {}), newArtists: true } : withFill;
    if (discovery === undefined || discovery === "mixed") return withNew;
    return { ...(withNew ?? {}), discovery };
}

function buildSessionPreferencesBase({
    activePreset,
    request,
    sentence,
    artists = [],
    seed = null,
}: {
    activePreset: SessionPreset | null;
    request: AgentSessionRequest | null;
    sentence?: string | null;
    artists?: readonly string[];
    seed?: DjSeed | null;
}): AgentNextPreferences | undefined {
    const seedField = seed ? { seed: { kind: seed.kind, id: seed.id, label: seed.label } } : {};
    if (activePreset) {
        if (!request) return { ...toIntentPreferences(activePreset), ...seedField };
        // The Adjust row can change the starter's energy (or clear it): the request wins, so the
        // session never carries two different energies.
        return { ...toIntentPreferences(activePreset), request, energy: request.energy ?? undefined, ...seedField };
    }
    const text = sentence?.trim();
    const sentenceFields = {
        ...(text ? { requestText: text } : {}),
        ...(artists.length > 0 ? { artists: [...artists] } : {}),
        ...seedField,
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
    seed = null,
    fillSimilar,
    newArtists,
    discovery,
}: {
    activePreset: SessionPreset | null;
    request: AgentSessionRequest | null;
    savedVibes?: string[];
    sentence?: string | null;
    artists?: readonly string[];
    seed?: DjSeed | null;
    /**
     * "Fill with similar sounds" (#2316). A pick request states it either way when
     * the caller knows it, because the server remembers the earlier value when the
     * key is omitted; `false` turns padding back off.
     */
    fillSimilar?: boolean;
    /**
     * "New artists only" (#2249). Stated either way when the caller knows it, for the same
     * reason as `fillSimilar`: the server remembers the earlier value when the key is omitted.
     */
    newArtists?: boolean;
    /**
     * The Discovery control (#2327). Stated either way when the caller knows it (including
     * "mixed"), for the same reason as `fillSimilar`: the server remembers the earlier value
     * when the key is omitted.
     */
    discovery?: AgentDiscoveryLevel;
}): AgentNextPreferences {
    const built = buildSessionPreferences({ activePreset, request, sentence, artists, seed });
    const fillField = {
        ...(fillSimilar === undefined ? {} : { fillSimilar }),
        ...(newArtists === undefined ? {} : { newArtists }),
        ...(discovery === undefined ? {} : { discovery }),
    };
    // The server remembers a live session's earlier preferences when a key is omitted, so a sentence
    // or artists the listener has since dropped are cleared explicitly (empty values).
    // A seed the listener removed is cleared the same way (`null`), because omitting it keeps it.
    const sentenceReset = { requestText: "", artists: [] as string[], seed: null as AgentNextPreferences["seed"] };
    if (built && (built.request || built.sessionIntent)) return { ...sentenceReset, ...built, ...fillField };
    // No chips: the saved vibes are where the session starts, plus any sentence.
    return {
        genres: savedVibes,
        ...(request ? { request } : {}),
        ...sentenceReset,
        ...(built ?? {}),
        ...fillField,
    };
}
