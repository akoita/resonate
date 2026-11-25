/**
 * Rate-limit counts shared across instances through Redis (#309 app half).
 *
 * Two storages stand in for two backend instances; they share one Redis, as
 * every instance does in a deployment.
 */
import Redis from "ioredis";
import { createRateLimitRedisClient, RedisRateLimitStorage } from "../modules/shared/rate_limit_storage";

const PREFIX = `ratelimit_test_${Date.now()}`;

describe("RedisRateLimitStorage", () => {
  let a: RedisRateLimitStorage;
  let b: RedisRateLimitStorage;
  let admin: Redis;

  beforeAll(async () => {
    a = new RedisRateLimitStorage(createRateLimitRedisClient(), PREFIX);
    b = new RedisRateLimitStorage(createRateLimitRedisClient(), PREFIX);
    admin = new Redis({
      host: process.env.REDIS_HOST || "localhost",
      port: Number.parseInt(process.env.REDIS_PORT || "6379", 10),
    });
    // The store's clients connect lazily; wait until both answer.
    await admin.ping();
    await new Promise((resolve) => setTimeout(resolve, 200));
  });

  afterAll(async () => {
    const keys = await admin.keys(`${PREFIX}:*`);
    if (keys.length) await admin.del(...keys);
    await a.onModuleDestroy();
    await b.onModuleDestroy();
    await admin.quit();
  });

  it("counts one limit across instances", async () => {
    const key = "shared";
    expect(await a.increment(key, 60_000, 3, 60_000, "default")).toMatchObject({ totalHits: 1, isBlocked: false });
    expect(await b.increment(key, 60_000, 3, 60_000, "default")).toMatchObject({ totalHits: 2, isBlocked: false });
    expect(await a.increment(key, 60_000, 3, 60_000, "default")).toMatchObject({ totalHits: 3, isBlocked: false });

    const refused = await b.increment(key, 60_000, 3, 60_000, "default");
    expect(refused.isBlocked).toBe(true);
    expect(refused.timeToBlockExpire).toBeGreaterThan(0);
    expect(refused.timeToBlockExpire).toBeLessThanOrEqual(60);

    // Still blocked on the other instance.
    expect((await a.increment(key, 60_000, 3, 60_000, "default")).isBlocked).toBe(true);
  });

  it("keeps keys and throttler names apart", async () => {
    await a.increment("one", 60_000, 1, 60_000, "default");
    expect((await a.increment("two", 60_000, 1, 60_000, "default")).isBlocked).toBe(false);
    expect((await a.increment("one", 60_000, 1, 60_000, "other")).isBlocked).toBe(false);
  });

  it("starts a fresh window once the block ends", async () => {
    const key = "short";
    await a.increment(key, 300, 1, 300, "default");
    expect((await b.increment(key, 300, 1, 300, "default")).isBlocked).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(await a.increment(key, 300, 1, 300, "default")).toMatchObject({ totalHits: 1, isBlocked: false });
  });

  it("puts an expiry on every key it writes", async () => {
    await a.increment("expiring", 60_000, 1, 60_000, "default");
    await a.increment("expiring", 60_000, 1, 60_000, "default");
    const keys = await admin.keys(`${PREFIX}:{default:expiring}:*`);
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) {
      expect(await admin.pttl(k)).toBeGreaterThan(0);
    }
  });
});
