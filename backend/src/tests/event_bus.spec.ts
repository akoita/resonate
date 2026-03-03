/**
 * EventBus unit tests — Issue #362
 *
 * Tests the central EventBus used for cross-module communication.
 * Uses real event names from event_types.ts for type safety.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { EventBus } from '../modules/shared/event_bus';

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  it('delivers events to subscribers', () => {
    const received: any[] = [];
    bus.subscribe('stems.uploaded', (e: any) => received.push(e));

    bus.publish({
      eventName: 'stems.uploaded',
      releaseId: 'rel-1',
      trackId: 'trk-1',
      stems: [],
    } as any);

    expect(received).toHaveLength(1);
    expect(received[0].releaseId).toBe('rel-1');
  });

  it('does not deliver events to wrong subscriber', () => {
    const received: any[] = [];
    bus.subscribe('stems.processed', (e: any) => received.push(e));

    bus.publish({
      eventName: 'stems.uploaded',
      releaseId: 'rel-1',
      trackId: 'trk-1',
      stems: [],
    } as any);

    expect(received).toHaveLength(0);
  });

  it('supports multiple subscribers for same event', () => {
    let count = 0;
    bus.subscribe('ipnft.minted', () => count++);
    bus.subscribe('ipnft.minted', () => count++);

    bus.publish({
      eventName: 'ipnft.minted',
      stemId: 'stem-1',
      tokenId: '1',
      transactionHash: '0x...',
      contractAddress: '0x...',
    } as any);

    expect(count).toBe(2);
  });


  it('delivers catalog track status events correctly', () => {
    const stages: string[] = [];

    bus.subscribe('catalog.track_status', (e: any) => stages.push(e.stage));

    // Simulate ingestion lifecycle
    const events = ['pending', 'separating', 'encrypting', 'storing', 'complete'];
    for (const stage of events) {
      bus.publish({
        eventName: 'catalog.track_status',
        trackId: 't-1',
        releaseId: 'r-1',
        stage,
      } as any);
    }

    expect(stages).toEqual(events);
  });

  it('propagates subscriber errors (fail-fast for debugging)', () => {
    bus.subscribe('stems.uploaded', () => { throw new Error('subscriber crash'); });

    // EventBus lets errors propagate — correct for fail-fast debugging
    expect(() => bus.publish({ eventName: 'stems.uploaded' } as any)).toThrow('subscriber crash');
  });
});
