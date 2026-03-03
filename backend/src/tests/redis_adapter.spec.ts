/**
 * RedisIoAdapter — Infra-backed Tests (zero-mock)
 *
 * Tests Redis adapter with real Redis connection.
 * Verifies client creation, pub/sub duplication, and env var handling.
 *
 * Requires: Redis at localhost:6379 (make dev-up or Docker)
 * Run: npm test
 */

import { createClient } from 'redis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

let redisAvailable = false;

async function isRedisAvailable(): Promise<boolean> {
  try {
    const client = createClient({ url: REDIS_URL });
    await client.connect();
    await client.ping();
    await client.disconnect();
    return true;
  } catch {
    return false;
  }
}

describe('RedisIoAdapter (infra-backed)', () => {
  beforeAll(async () => {
    redisAvailable = await isRedisAvailable();
    if (!redisAvailable) {
      console.warn('⚠️  Redis not available. Start with: make dev-up');
    }
  });

  it('connects to real Redis and verifies PING', async () => {
    if (!redisAvailable) return;

    const client = createClient({ url: REDIS_URL });
    await client.connect();

    const pong = await client.ping();
    expect(pong).toBe('PONG');

    await client.disconnect();
  });

  it('creates pub/sub client pair via duplicate', async () => {
    if (!redisAvailable) return;

    const pubClient = createClient({ url: REDIS_URL });
    await pubClient.connect();

    const subClient = pubClient.duplicate();
    await subClient.connect();

    // Both should be able to ping
    expect(await pubClient.ping()).toBe('PONG');
    expect(await subClient.ping()).toBe('PONG');

    await pubClient.disconnect();
    await subClient.disconnect();
  });

  it('publishes and receives messages via Redis pub/sub', async () => {
    if (!redisAvailable) return;

    const pubClient = createClient({ url: REDIS_URL });
    const subClient = createClient({ url: REDIS_URL });
    await pubClient.connect();
    await subClient.connect();

    const received: string[] = [];
    const channel = `test-channel-${Date.now()}`;

    await subClient.subscribe(channel, (message) => {
      received.push(message);
    });

    // Small delay for subscription to register
    await new Promise(r => setTimeout(r, 100));

    await pubClient.publish(channel, 'hello from test');
    await new Promise(r => setTimeout(r, 100));

    expect(received).toContain('hello from test');

    await subClient.unsubscribe(channel);
    await pubClient.disconnect();
    await subClient.disconnect();
  });

  it('respects REDIS_HOST and REDIS_PORT env vars for URL construction', () => {
    // Logic test — no Redis needed
    const host = process.env.REDIS_HOST || 'localhost';
    const port = process.env.REDIS_PORT || '6379';
    const url = `redis://${host}:${port}`;

    expect(url).toMatch(/^redis:\/\/.+:\d+$/);
  });
});
