import type { ModelParseAnswer, ModelParseGuard } from "../crates/model_crate_request_parser";

/**
 * Cache and budget for the AI DJ session parser's model calls (#2241).
 *
 *  - Cache: the model's answer for a (model, normalized sentence hash) key, so
 *    a repeated sentence makes no new call. Memory only, short lived, bounded;
 *    it holds the parsed answer (filters, quoted phrases, artist names), never
 *    the sentence, and is never written anywhere.
 *  - Budget: at most N model calls per listener per UTC day, a small per-minute
 *    burst limit per listener, and a global daily circuit breaker. All counters
 *    are per server instance (Cloud Run scales out), so the real daily ceiling
 *    is the limit times the instance count; the provider's own quota is the
 *    hard stop. Over budget the caller uses the rules-only parse silently.
 */

const CACHE_TTL_MS = 60 * 60_000;
const CACHE_MAX_ENTRIES = 500;
const BURST_WINDOW_MS = 60_000;
/** Per-listener memory bound: counters for the most recent listeners only. */
const MAX_TRACKED_USERS = 5_000;

export const DEFAULT_PARSER_USER_DAILY_LIMIT = 30;
export const DEFAULT_PARSER_USER_BURST_LIMIT = 6;
export const DEFAULT_PARSER_GLOBAL_DAILY_LIMIT = 5_000;

export interface SessionParserGuardLimits {
  userDaily: number;
  userBurst: number;
  globalDaily: number;
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return value && Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

export function sessionParserGuardLimits(env: NodeJS.ProcessEnv = process.env): SessionParserGuardLimits {
  return {
    userDaily: positiveInt(env.AGENT_SESSION_PARSER_USER_DAILY_LIMIT, DEFAULT_PARSER_USER_DAILY_LIMIT),
    userBurst: positiveInt(env.AGENT_SESSION_PARSER_USER_BURST_LIMIT, DEFAULT_PARSER_USER_BURST_LIMIT),
    globalDaily: positiveInt(env.AGENT_SESSION_PARSER_GLOBAL_DAILY_LIMIT, DEFAULT_PARSER_GLOBAL_DAILY_LIMIT),
  };
}

type UserCounter = { day: string; count: number; burstStartedAt: number; burstCount: number };

export class SessionParserGuard implements ModelParseGuard {
  private readonly cache = new Map<string, { answer: ModelParseAnswer; at: number }>();
  private readonly users = new Map<string, UserCounter>();
  private globalDay = "";
  private globalCount = 0;

  constructor(
    private readonly limits: SessionParserGuardLimits = sessionParserGuardLimits(),
    private readonly now: () => number = Date.now,
  ) {}

  recall(key: string): ModelParseAnswer | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (this.now() - entry.at > CACHE_TTL_MS) {
      this.cache.delete(key);
      return undefined;
    }
    return structuredClone(entry.answer);
  }

  remember(key: string, answer: ModelParseAnswer): void {
    this.cache.delete(key);
    this.cache.set(key, { answer: structuredClone(answer), at: this.now() });
    if (this.cache.size > CACHE_MAX_ENTRIES) {
      this.cache.delete(this.cache.keys().next().value as string);
    }
  }

  admit(userId: string | undefined): boolean {
    const now = this.now();
    const day = new Date(now).toISOString().slice(0, 10);
    if (this.globalDay !== day) {
      this.globalDay = day;
      this.globalCount = 0;
    }
    // A call with no signed-in listener is never made: the route requires one.
    if (!userId) return false;
    if (this.globalCount >= this.limits.globalDaily) return false;

    const counter = this.users.get(userId) ?? { day, count: 0, burstStartedAt: now, burstCount: 0 };
    if (counter.day !== day) {
      counter.day = day;
      counter.count = 0;
    }
    if (now - counter.burstStartedAt >= BURST_WINDOW_MS) {
      counter.burstStartedAt = now;
      counter.burstCount = 0;
    }
    if (counter.count >= this.limits.userDaily || counter.burstCount >= this.limits.userBurst) return false;

    counter.count += 1;
    counter.burstCount += 1;
    this.globalCount += 1;
    this.users.delete(userId);
    this.users.set(userId, counter);
    if (this.users.size > MAX_TRACKED_USERS) {
      this.users.delete(this.users.keys().next().value as string);
    }
    return true;
  }
}
