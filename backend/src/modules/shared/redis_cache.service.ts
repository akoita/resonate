import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { createClient, RedisClientType } from "redis";

/**
 * Minimal shared Redis JSON cache (#1448 WS-1).
 *
 * Purpose-built to FRONT durable Postgres state with hot reads — never to be
 * a source of truth. Every operation fails open: if Redis is down, slow, or
 * unconfigured, callers get `null`/no-op and MUST fall back to the database,
 * which keeps the deterministic-fallback acceptance criterion honest
 * (discovery must work with Redis unavailable).
 *
 * Connection is lazy (first use) over the same REDIS_HOST/REDIS_PORT the rest
 * of the platform uses (BullMQ, Socket.IO adapter — Memorystore in prod).
 */
@Injectable()
export class RedisCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisCacheService.name);
  private client: RedisClientType | null = null;
  private connecting: Promise<RedisClientType | null> | null = null;
  private warnedUnavailable = false;

  private async getClient(): Promise<RedisClientType | null> {
    if (this.client?.isReady) {
      return this.client;
    }
    if (!this.connecting) {
      this.connecting = (async () => {
        try {
          const host = process.env.REDIS_HOST || "localhost";
          const port = process.env.REDIS_PORT || "6379";
          const client: RedisClientType = createClient({
            url: `redis://${host}:${port}`,
            socket: {
              connectTimeout: 1500,
              // One quick retry, then give up — callers fall back to Postgres.
              reconnectStrategy: (retries) => (retries > 1 ? false : 250),
            },
          });
          client.on("error", () => {
            /* handled by fail-open returns; avoid noisy default logging */
          });
          await client.connect();
          this.client = client;
          this.warnedUnavailable = false;
          return client;
        } catch (error) {
          if (!this.warnedUnavailable) {
            this.warnedUnavailable = true;
            this.logger.warn(
              `Redis cache unavailable — falling back to database reads (${
                error instanceof Error ? error.message : String(error)
              })`,
            );
          }
          return null;
        } finally {
          this.connecting = null;
        }
      })();
    }
    return this.connecting;
  }

  /** Read a JSON value; null on miss OR any Redis unavailability. */
  async getJson<T>(key: string): Promise<T | null> {
    try {
      const client = await this.getClient();
      if (!client) return null;
      const raw = await client.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  /** Write a JSON value with a TTL; silently a no-op when Redis is down. */
  async setJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    try {
      const client = await this.getClient();
      if (!client) return;
      await client.set(key, JSON.stringify(value), { EX: ttlSeconds });
    } catch {
      /* fail open */
    }
  }

  /** Delete a key (cache invalidation); silently a no-op when Redis is down. */
  async del(key: string): Promise<void> {
    try {
      const client = await this.getClient();
      if (!client) return;
      await client.del(key);
    } catch {
      /* fail open */
    }
  }

  async onModuleDestroy() {
    try {
      await this.client?.quit();
    } catch {
      /* ignore */
    }
    this.client = null;
  }
}
