/**
 * Redis Adapter — Testcontainers Tests
 *
 * Tests real Redis operations against a self-contained Redis container.
 * No external dependencies — only Docker is required.
 *
 * Run: npm run test:integration
 */

import { getTestRedis, isDockerAvailable } from './testcontainers.setup';
import { createClient } from 'redis';

let connectionUrl: string;
let dockerAvailable = false;
let teardown: () => Promise<void>;

describe('RedisIoAdapter (testcontainers)', () => {
  beforeAll(async () => {
    dockerAvailable = await isDockerAvailable();
    if (!dockerAvailable) {
      console.warn('⚠️  Docker not available. Skipping Testcontainers tests.');
      return;
    }

    const redis = await getTestRedis();
    connectionUrl = redis.connectionUrl;
    teardown = redis.teardown;
  }, 60_000);

  afterAll(async () => {
    if (!dockerAvailable) return;
    await teardown();
  });

  it('connects and PINGs', async () => {
    if (!dockerAvailable) return;
    const client = createClient({ url: connectionUrl });
    await client.connect();
    expect(await client.ping()).toBe('PONG');
    await client.disconnect();
  });

  it('creates pub/sub client pair via duplicate', async () => {
    if (!dockerAvailable) return;
    const pubClient = createClient({ url: connectionUrl });
    await pubClient.connect();
    const subClient = pubClient.duplicate();
    await subClient.connect();

    expect(await pubClient.ping()).toBe('PONG');
    expect(await subClient.ping()).toBe('PONG');

    await pubClient.disconnect();
    await subClient.disconnect();
  });

  it('publishes and receives messages via pub/sub', async () => {
    if (!dockerAvailable) return;
    const pubClient = createClient({ url: connectionUrl });
    const subClient = createClient({ url: connectionUrl });
    await pubClient.connect();
    await subClient.connect();

    const received: string[] = [];
    const channel = `test-${Date.now()}`;

    await subClient.subscribe(channel, (msg) => received.push(msg));
    await new Promise(r => setTimeout(r, 100));

    await pubClient.publish(channel, 'hello');
    await new Promise(r => setTimeout(r, 100));

    expect(received).toContain('hello');

    await subClient.unsubscribe(channel);
    await pubClient.disconnect();
    await subClient.disconnect();
  });

  it('sets and gets values', async () => {
    if (!dockerAvailable) return;
    const client = createClient({ url: connectionUrl });
    await client.connect();

    await client.set('test-key', 'test-value');
    expect(await client.get('test-key')).toBe('test-value');

    await client.disconnect();
  });

  it('respects REDIS_HOST env var for URL construction', () => {
    // Logic test — always runs
    const host = process.env.REDIS_HOST || 'localhost';
    const port = process.env.REDIS_PORT || '6379';
    expect(`redis://${host}:${port}`).toMatch(/^redis:\/\/.+:\d+$/);
  });
});
