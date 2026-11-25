import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { ThrottlerStorage, ThrottlerStorageService } from "@nestjs/throttler";
import Redis from "ioredis";

/**
 * Where rate-limit counts live (`RATE_LIMIT_STORE`).
 *
 * - `redis`: one count per key across every backend instance, so a limit of
 *   six a minute means six a minute, not six per instance the load balancer
 *   happens to pick. Uses the platform's `REDIS_HOST` / `REDIS_PORT`.
 * - `memory`: the throttler's own per-process store. Right for local
 *   development and unit tests, where there is one process.
 *
 * When the variable is unset, `redis` is chosen if `REDIS_HOST` is set and
 * `memory` otherwise.
 */
export type RateLimitStoreKind = "redis" | "memory";

export function rateLimitStoreKind(env: NodeJS.ProcessEnv = process.env): RateLimitStoreKind {
  const explicit = env.RATE_LIMIT_STORE?.trim().toLowerCase();
  if (explicit === "redis" || explicit === "memory") return explicit;
  if (explicit) {
    throw new Error(`RATE_LIMIT_STORE must be "redis" or "memory", got "${env.RATE_LIMIT_STORE}"`);
  }
  return env.REDIS_HOST?.trim() ? "redis" : "memory";
}

/**
 * Fixed window with a block, the same contract as the in-memory store:
 * a hit past `limit` blocks the key for `blockDuration`, hits while blocked are
 * not counted, and the window starts again once the block ends.
 *
 * KEYS[1] hit counter, KEYS[2] block marker.
 * ARGV[1] window ms, ARGV[2] limit, ARGV[3] block ms.
 * Returns { hits, window ms left, blocked 0|1, block ms left }.
 */
const INCREMENT_SCRIPT = `
local blockLeft = redis.call('PTTL', KEYS[2])
if blockLeft > 0 then
  local hits = tonumber(redis.call('GET', KEYS[1]) or '0')
  local left = redis.call('PTTL', KEYS[1])
  if left < 0 then left = 0 end
  return { hits, left, 1, blockLeft }
end
local hits = redis.call('INCR', KEYS[1])
local left = redis.call('PTTL', KEYS[1])
if left < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  left = tonumber(ARGV[1])
end
if hits > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  redis.call('DEL', KEYS[1])
  return { hits, left, 1, tonumber(ARGV[3]) }
end
return { hits, left, 0, 0 }
`;

type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage["increment"]>>;

type IncrementReply = [number, number, number, number];

/** The subset of an ioredis client the store uses, so tests can pass their own. */
export interface RateLimitRedisClient {
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
  quit(): Promise<unknown>;
}

function toSeconds(ms: number): number {
  return Math.max(0, Math.ceil(ms / 1000));
}

/**
 * Throttler storage shared across instances through Redis.
 *
 * It never turns a Redis outage into an API outage: when a command fails it
 * counts in this process instead (the per-instance behaviour every deployment
 * had before), warns once per outage, and returns to Redis as soon as a
 * command succeeds again.
 */
@Injectable()
export class RedisRateLimitStorage implements ThrottlerStorage, OnModuleDestroy {
  private readonly logger = new Logger(RedisRateLimitStorage.name);
  private readonly fallback = new ThrottlerStorageService();
  private degraded = false;

  constructor(
    private readonly client: RateLimitRedisClient,
    private readonly prefix = "ratelimit",
  ) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    // The hash tag keeps both keys in one slot should Redis ever be clustered.
    const base = `${this.prefix}:{${throttlerName}:${key}}`;
    try {
      const reply = (await this.client.eval(
        INCREMENT_SCRIPT,
        2,
        `${base}:hits`,
        `${base}:block`,
        Math.max(1, Math.round(ttl)),
        limit,
        Math.max(1, Math.round(blockDuration)),
      )) as IncrementReply;
      if (this.degraded) {
        this.degraded = false;
        this.logger.log("Rate-limit store reachable again; counting across instances");
      }
      const [hits, windowLeft, blocked, blockLeft] = reply.map(Number);
      return {
        totalHits: hits,
        timeToExpire: toSeconds(windowLeft),
        isBlocked: blocked === 1,
        timeToBlockExpire: toSeconds(blockLeft),
      };
    } catch (error) {
      if (!this.degraded) {
        this.degraded = true;
        this.logger.warn(
          `Rate-limit store unavailable; counting per instance until it returns (${
            error instanceof Error ? error.message : String(error)
          })`,
        );
      }
      return this.fallback.increment(key, ttl, limit, blockDuration, throttlerName);
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.fallback.onApplicationShutdown();
    await this.client.quit().catch(() => undefined);
  }
}

/** A Redis client that fails fast instead of queueing while disconnected. */
export function createRateLimitRedisClient(env: NodeJS.ProcessEnv = process.env): Redis {
  const client = new Redis({
    host: env.REDIS_HOST || "localhost",
    port: Number.parseInt(env.REDIS_PORT || "6379", 10),
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 1_500,
    retryStrategy: (attempt) => Math.min(attempt * 500, 5_000),
  });
  client.on("error", () => {
    /* surfaced once per outage by RedisRateLimitStorage */
  });
  void client.connect().catch(() => undefined);
  return client;
}

/** The storage `ThrottlerModule` should use in this environment. */
export function createRateLimitStorage(env: NodeJS.ProcessEnv = process.env): ThrottlerStorage {
  if (rateLimitStoreKind(env) === "memory") {
    return new ThrottlerStorageService();
  }
  return new RedisRateLimitStorage(createRateLimitRedisClient(env));
}
