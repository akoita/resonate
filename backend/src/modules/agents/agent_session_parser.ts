import { CRATE_REQUEST_MAX_TEXT_LENGTH, type CrateParseResult } from "../crates/crate.types";
import { parseCrateRequestText, type CrateRequestParser } from "../crates/crate_request_parser";
import {
  ModelCrateRequestParser,
  type ModelCrateRequestParserDeps,
  type ModelParseGuard,
} from "../crates/model_crate_request_parser";
import { withoutArtistMentions } from "./agent_session_artists";
import { readListenerWords } from "./agent_session_listener_words";
import type { SessionArtistResolver } from "./agent_session_artist_resolver";
import { SessionParserGuard } from "./agent_session_parser_guard";

/**
 * The parser behind `POST /agents/config/session/parse` (#2241).
 *
 * Rules always run, in three layers over the same sentence:
 *  1. the Crate Digger rules read genres, moods, energy and tempo (DJ words);
 *  2. the artist rules read cued catalog artist names ("like X", "more X",
 *     "X-style"); a resolved artist leaves "Didn't catch";
 *  3. the listener layer (agent_session_listener_words.ts, #2452) reads what is
 *     still unread: calm/gym/party words, French and accented spellings, and
 *     one-edit genre typos. It runs after the artist names are removed, so an
 *     artist's name is never read as a genre.
 * Crate Digger itself uses only layer 1 and is unchanged.
 *
 * `AGENT_SESSION_PARSER_STRATEGY=model-assisted` (default `deterministic`, in
 * every environment) wraps the rules with the shared model parser, which then
 * runs only for a sentence the rules left partly unread. Crate Digger keeps its
 * own flag, `CRATE_REQUEST_PARSER_STRATEGY`.
 */

export type AgentSessionParserStrategy = "deterministic" | "model-assisted";

export function agentSessionParserStrategy(env: NodeJS.ProcessEnv = process.env): AgentSessionParserStrategy {
  const normalized = env.AGENT_SESSION_PARSER_STRATEGY?.trim().toLowerCase();
  return normalized === "model-assisted" || normalized === "model_assisted" ? "model-assisted" : "deterministic";
}

/**
 * Crate Digger rules, cued catalog artist names, then the listener layer. Pure
 * apart from the catalog lookup.
 */
export class ArtistAwareRulesParser implements CrateRequestParser {
  constructor(private readonly artists: SessionArtistResolver) {}

  async parse(text: string): Promise<CrateParseResult> {
    const bounded = typeof text === "string" ? text.slice(0, CRATE_REQUEST_MAX_TEXT_LENGTH) : "";
    const parsed = parseCrateRequestText(bounded);
    const mentions = await this.artists.mentionsIn(bounded);
    if (mentions.length === 0) return readListenerWords(parsed);
    return readListenerWords({
      ...parsed,
      unparsed: withoutArtistMentions(parsed.unparsed, mentions),
      artists: mentions.map((mention) => mention.name),
    });
  }
}

export interface AgentSessionParserDeps extends Pick<ModelCrateRequestParserDeps, "createClient" | "logger"> {
  guard?: ModelParseGuard;
}

export function createAgentSessionRequestParser(
  artists: SessionArtistResolver,
  env: NodeJS.ProcessEnv = process.env,
  deps: AgentSessionParserDeps = {},
): CrateRequestParser {
  const rules = new ArtistAwareRulesParser(artists);
  if (agentSessionParserStrategy(env) !== "model-assisted") return rules;
  return new ModelCrateRequestParser({
    createClient: deps.createClient,
    logger: deps.logger,
    fallback: rules,
    env,
    session: {
      resolveArtistNames: (names) => artists.resolveNames(names),
      guard: deps.guard ?? new SessionParserGuard(),
      modelEnv: "AGENT_SESSION_PARSER_MODEL",
      timeoutEnv: "AGENT_SESSION_PARSER_TIMEOUT_MS",
    },
  });
}
