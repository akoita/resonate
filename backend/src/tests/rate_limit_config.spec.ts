import { trackByUser } from "../modules/shared/rate_limits";
import {
  RateLimitRedisClient,
  RedisRateLimitStorage,
  rateLimitStoreKind,
} from "../modules/shared/rate_limit_storage";
import { applyTrustProxy, trustProxyHops } from "../config/trust_proxy";

describe("trackByUser", () => {
  it("tracks a signed-in person by id, apart from any address", () => {
    expect(trackByUser({ user: { userId: "0xabc" }, ip: "10.0.0.1" })).toBe("user:0xabc");
  });

  it("falls back to the address for an anonymous request", () => {
    expect(trackByUser({ ip: "10.0.0.1" })).toBe("ip:10.0.0.1");
    expect(trackByUser({ user: { userId: "" }, ip: "10.0.0.1" })).toBe("ip:10.0.0.1");
  });
});

describe("trustProxyHops", () => {
  it("trusts nothing unless told how many proxies there are", () => {
    expect(trustProxyHops({})).toBeUndefined();
    expect(trustProxyHops({ TRUST_PROXY_HOPS: "" })).toBeUndefined();
    expect(trustProxyHops({ TRUST_PROXY_HOPS: "0" })).toBeUndefined();
  });

  it("accepts a whole number of hops", () => {
    expect(trustProxyHops({ TRUST_PROXY_HOPS: "1" })).toBe(1);
    expect(trustProxyHops({ TRUST_PROXY_HOPS: " 2 " })).toBe(2);
  });

  it("refuses values that would trust every proxy or none sensibly", () => {
    expect(() => trustProxyHops({ TRUST_PROXY_HOPS: "true" })).toThrow(/whole number/);
    expect(() => trustProxyHops({ TRUST_PROXY_HOPS: "-1" })).toThrow(/whole number/);
    expect(() => trustProxyHops({ TRUST_PROXY_HOPS: "1.5" })).toThrow(/whole number/);
    expect(() => trustProxyHops({ TRUST_PROXY_HOPS: "50" })).toThrow(/at most 10/);
  });

  it("sets Express trust proxy only when configured", () => {
    const set = jest.fn();
    expect(applyTrustProxy({ set }, {})).toBeUndefined();
    expect(set).not.toHaveBeenCalled();
    expect(applyTrustProxy({ set }, { TRUST_PROXY_HOPS: "1" })).toBe(1);
    expect(set).toHaveBeenCalledWith("trust proxy", 1);
  });
});

describe("rateLimitStoreKind", () => {
  it("follows an explicit choice", () => {
    expect(rateLimitStoreKind({ RATE_LIMIT_STORE: "memory", REDIS_HOST: "redis" })).toBe("memory");
    expect(rateLimitStoreKind({ RATE_LIMIT_STORE: "Redis" })).toBe("redis");
  });

  it("uses Redis when the platform Redis is configured, memory otherwise", () => {
    expect(rateLimitStoreKind({ REDIS_HOST: "10.0.0.5" })).toBe("redis");
    expect(rateLimitStoreKind({})).toBe("memory");
  });

  it("refuses an unknown store", () => {
    expect(() => rateLimitStoreKind({ RATE_LIMIT_STORE: "postgres" })).toThrow(/redis.*memory/);
  });
});

describe("RedisRateLimitStorage when Redis is unreachable", () => {
  const failing: RateLimitRedisClient = {
    eval: jest.fn().mockRejectedValue(new Error("Stream isn't writeable")),
    quit: jest.fn().mockResolvedValue("OK"),
  };

  it("keeps limiting in this process instead of failing the request", async () => {
    const storage = new RedisRateLimitStorage(failing);
    const first = await storage.increment("k", 60_000, 1, 60_000, "default");
    const second = await storage.increment("k", 60_000, 1, 60_000, "default");
    expect(first).toMatchObject({ totalHits: 1, isBlocked: false });
    expect(second).toMatchObject({ isBlocked: true });
    await storage.onModuleDestroy();
  });
});
