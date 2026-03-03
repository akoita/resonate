/**
 * Pub/Sub Publisher — Testcontainers Integration Test
 *
 * Tests StemPubSubPublisher against a real Google Pub/Sub emulator.
 * Verifies topic/subscription creation and message publishing end-to-end.
 *
 * Container managed by Jest globalSetup (PUBSUB_EMULATOR_HOST set automatically).
 * Run: npm run test:integration
 */

import { PubSub } from '@google-cloud/pubsub';
import { StemPubSubPublisher } from '../modules/ingestion/stem-pubsub.publisher';

const emulatorHost = () => process.env.PUBSUB_EMULATOR_HOST;

describe('StemPubSubPublisher (integration)', () => {
  let publisher: StemPubSubPublisher;
  let pubsub: PubSub;

  beforeAll(async () => {
    if (!emulatorHost()) {
      console.warn('⚠️  PUBSUB_EMULATOR_HOST not set. Skipping Pub/Sub integration tests.');
      return;
    }
    process.env.STEM_PROCESSING_MODE = 'pubsub';

    pubsub = new PubSub({ projectId: process.env.GCP_PROJECT_ID || 'resonate-local' });
    publisher = new StemPubSubPublisher();
  });

  afterAll(async () => {
    delete process.env.STEM_PROCESSING_MODE;
  });

  it('creates topics on init', async () => {
    if (!emulatorHost()) return;

    await publisher.onModuleInit();

    // Verify topics exist in the emulator
    const [topics] = await pubsub.getTopics();
    const topicNames = topics.map(t => t.name);
    expect(topicNames.some(n => n.includes('stem-separate'))).toBe(true);
    expect(topicNames.some(n => n.includes('stem-results'))).toBe(true);
  });

  it('creates stem-separate-worker subscription', async () => {
    if (!emulatorHost()) return;

    await publisher.onModuleInit();

    const [subscriptions] = await pubsub.getSubscriptions();
    const subNames = subscriptions.map(s => s.name);
    expect(subNames.some(n => n.includes('stem-separate-worker'))).toBe(true);
  });

  it('publishes a separation job and receives it', async () => {
    if (!emulatorHost()) return;

    await publisher.onModuleInit();

    const message = {
      jobId: 'sep_integ_test_1',
      releaseId: 'rel_integ',
      artistId: 'artist_integ',
      trackId: 'trk_integ',
      originalStemUri: 'http://host.docker.internal:3000/test.mp3',
      mimeType: 'audio/mpeg',
    };

    const messageId = await publisher.publishSeparationJob(message);
    expect(messageId).toBeDefined();
    expect(typeof messageId).toBe('string');

    // Verify we can pull the message from the subscription
    const sub = pubsub.subscription('stem-separate-worker');
    const received = await new Promise<any>((resolve) => {
      const timeout = setTimeout(() => resolve(null), 5000);
      sub.on('message', (msg: any) => {
        clearTimeout(timeout);
        msg.ack();
        resolve(JSON.parse(msg.data.toString()));
      });
    });

    expect(received).not.toBeNull();
    expect(received.jobId).toBe('sep_integ_test_1');
    expect(received.trackId).toBe('trk_integ');
    expect(received.originalStemUri).toContain('test.mp3');

    sub.removeAllListeners();
  });
});
