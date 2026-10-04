/**
 * Sessions Service — Integration Test (Testcontainers)
 *
 * Tests SessionsService with real Postgres for session records.
 * Real WalletService with providerRegistry stub (returns deterministic address).
 *
 * Run: npm run test:integration
 */

import { NotFoundException } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { prisma } from '../db/prisma';
import { ANALYTICS_CONSENT_POLICY_VERSION } from '../modules/analytics/analytics_consent.service';
import { UnmetDemandService } from '../modules/scene_scout/unmet_demand.service';
import { SessionsService } from '../modules/sessions/sessions.service';
import { WalletService } from '../modules/identity/wallet.service';
import { EventBus } from '../modules/shared/event_bus';

const TEST_PREFIX = `sess_${Date.now()}_`;
const JAZZ_ARTIST = `${TEST_PREFIX}jazz_artist`;
const JAZZ_RELEASE = `${TEST_PREFIX}jazz_release`;
const JAZZ_TRACK = `${TEST_PREFIX}jazz_track`;

describe('SessionsService (integration)', () => {
  beforeAll(async () => {
    await prisma.user.create({
      data: { id: `${TEST_PREFIX}user`, email: `${TEST_PREFIX}user@test.resonate` },
    });
    await prisma.user.create({
      data: { id: `${TEST_PREFIX}other`, email: `${TEST_PREFIX}other@test.resonate` },
    });
    await prisma.artist.create({
      data: {
        id: `${TEST_PREFIX}artist`,
        userId: `${TEST_PREFIX}user`,
        displayName: 'Session Runtime Artist',
        payoutAddress: '0x' + 'B'.repeat(40),
      },
    });
    await prisma.release.create({
      data: {
        id: `${TEST_PREFIX}release`,
        artistId: `${TEST_PREFIX}artist`,
        title: 'Session Runtime Release',
        status: 'published',
      },
    });
    await prisma.track.create({
      data: {
        id: `${TEST_PREFIX}track`,
        releaseId: `${TEST_PREFIX}release`,
        title: 'Session Runtime Track',
        position: 1,
      },
    });
    await prisma.artist.create({
      data: {
        id: JAZZ_ARTIST,
        userId: `${TEST_PREFIX}other`,
        displayName: 'Session Demand Jazz Artist',
        payoutAddress: '0x' + 'C'.repeat(40),
      },
    });
    await prisma.release.create({
      data: {
        id: JAZZ_RELEASE,
        artistId: JAZZ_ARTIST,
        title: 'Session Demand Jazz Release',
        status: 'published',
        genre: 'Jazz',
      },
    });
    await prisma.track.create({
      data: {
        id: JAZZ_TRACK,
        releaseId: JAZZ_RELEASE,
        title: 'Session Demand Jazz Track',
        position: 1,
        processingStatus: 'complete',
        contentStatus: 'clean',
        explicit: false,
        aiDisclosureLevel: 'NONE',
      },
    });
  });

  afterAll(async () => {
    await prisma.demandObservation.deleteMany({ where: { userId: `${TEST_PREFIX}user` } }).catch(() => {});
    await prisma.analyticsConsent.deleteMany({ where: { userId: `${TEST_PREFIX}user` } }).catch(() => {});
    await prisma.payment.deleteMany({ where: { session: { userId: `${TEST_PREFIX}user` } } }).catch(() => {});
    await prisma.license.deleteMany({ where: { track: { release: { artist: { userId: `${TEST_PREFIX}user` } } } } }).catch(() => {});
    await prisma.session.deleteMany({ where: { userId: `${TEST_PREFIX}user` } }).catch(() => {});
    await prisma.wallet.deleteMany({ where: { userId: `${TEST_PREFIX}user` } }).catch(() => {});
    await prisma.stem.deleteMany({ where: { trackId: `${TEST_PREFIX}track` } }).catch(() => {});
    await prisma.track.deleteMany({ where: { releaseId: JAZZ_RELEASE } }).catch(() => {});
    await prisma.release.delete({ where: { id: JAZZ_RELEASE } }).catch(() => {});
    await prisma.artist.delete({ where: { id: JAZZ_ARTIST } }).catch(() => {});
    await prisma.track.deleteMany({ where: { releaseId: `${TEST_PREFIX}release` } }).catch(() => {});
    await prisma.release.delete({ where: { id: `${TEST_PREFIX}release` } }).catch(() => {});
    await prisma.artist.delete({ where: { id: `${TEST_PREFIX}artist` } }).catch(() => {});
    await prisma.user.delete({ where: { id: `${TEST_PREFIX}user` } }).catch(() => {});
    await prisma.user.delete({ where: { id: `${TEST_PREFIX}other` } }).catch(() => {});
  });

  function makeService(
    runtimeService: any = { runCommerce: jest.fn() },
    agentLearningService?: any,
    unmetDemand?: UnmetDemandService,
  ) {
    const eventBus = new EventBus();
    const providerRegistry = {
      getProvider: () => ({
        getAccount: (uid: string) => ({
          address: '0x' + uid.slice(0, 40).padEnd(40, '0'),
          chainId: 31337,
          accountType: 'eoa',
          provider: 'local',
          ownerAddress: null, entryPoint: null, factory: null,
          paymaster: null, bundler: null, salt: null,
        }),
      }),
    };
    const walletService = new WalletService(
      eventBus as any,
      providerRegistry as any,
      {} as any, // Erc4337Client — not called
      {} as any, // PaymasterService — not called
      {} as any, // KernelAccountService — not called
    );
    const agentPurchaseService = { purchase: async () => {} } as any;
    return {
      eventBus,
      service: new SessionsService(
        walletService,
        eventBus,
        runtimeService,
        agentPurchaseService,
        agentLearningService,
        unmetDemand,
      ),
    };
  }

  it('creates a session with budget cap', async () => {
    const { service } = makeService();
    const session = await service.startSession({
      userId: `${TEST_PREFIX}user`,
      budgetCapUsd: 10,
    });

    expect(session.id).toBeDefined();
    expect(session.userId).toBe(`${TEST_PREFIX}user`);

    const found = await prisma.session.findUnique({ where: { id: session.id } });
    expect(found).not.toBeNull();
    expect(found!.budgetCapUsd).toBe(10);

    // Verify real wallet was created in DB
    const wallet = await prisma.wallet.findFirst({ where: { userId: `${TEST_PREFIX}user` } });
    expect(wallet).not.toBeNull();
    expect(wallet!.monthlyCapUsd).toBe(10);
  });

  it('rejects an unknown My Mix lane before creating the session or wallet budget', async () => {
    const { service } = makeService();
    const beforeSessions = await prisma.session.count({ where: { userId: `${TEST_PREFIX}user` } });
    const beforeWallets = await prisma.wallet.count({ where: { userId: `${TEST_PREFIX}user` } });

    await expect(service.startSession({
      userId: `${TEST_PREFIX}user`,
      budgetCapUsd: 10,
      preferences: { myMix: { lanes: [{ id: 'not-a-visible-lane' }] } },
    })).rejects.toBeInstanceOf(BadRequestException);

    expect(await prisma.session.count({ where: { userId: `${TEST_PREFIX}user` } })).toBe(beforeSessions);
    expect(await prisma.wallet.count({ where: { userId: `${TEST_PREFIX}user` } })).toBe(beforeWallets);
  });

  it('does not allow another listener to request a private session pick', async () => {
    const runtimeService = { runCommerce: jest.fn() };
    const { service } = makeService(runtimeService);
    const session = await service.startSession({ userId: `${TEST_PREFIX}user`, budgetCapUsd: 10 });

    await expect(service.agentNext({ sessionId: session.id, userId: `${TEST_PREFIX}other` }))
      .rejects.toBeInstanceOf(NotFoundException);

    expect(runtimeService.runCommerce).not.toHaveBeenCalled();
    expect(await prisma.license.count({ where: { sessionId: session.id } })).toBe(0);
  });

  it('does not remember a rejected My Mix edit for the next continuation', async () => {
    const runtimeService = {
      runCommerce: jest.fn().mockResolvedValue({ status: 'no_tracks', tracks: [], shortfall: 1 }),
    };
    const { service } = makeService(runtimeService);
    const session = await service.startSession({ userId: `${TEST_PREFIX}user`, budgetCapUsd: 10 });

    await expect(service.agentNext({
      sessionId: session.id,
      userId: `${TEST_PREFIX}user`,
      preferences: { myMix: { lanes: [{ id: 'not-visible' }] } },
    })).rejects.toBeInstanceOf(BadRequestException);

    await expect(service.agentNext({ sessionId: session.id, userId: `${TEST_PREFIX}user` }))
      .resolves.toMatchObject({ status: 'no_tracks' });
    expect(runtimeService.runCommerce).toHaveBeenCalledTimes(1);
    expect(runtimeService.runCommerce.mock.calls[0][0].preferences).not.toHaveProperty('myMix');
  });

  it('records an unmet My Mix genre against existing catalog ownership', async () => {
    await prisma.analyticsConsent.upsert({
      where: { userId: `${TEST_PREFIX}user` },
      update: {
        productAnalytics: true,
        policyVersion: ANALYTICS_CONSENT_POLICY_VERSION,
        decidedAt: new Date(Date.now() - 60_000),
      },
      create: {
        userId: `${TEST_PREFIX}user`,
        productAnalytics: true,
        policyVersion: ANALYTICS_CONSENT_POLICY_VERSION,
        decidedAt: new Date(Date.now() - 60_000),
      },
    });
    const runtimeService = {
      runCommerce: jest.fn().mockResolvedValue({ status: 'no_tracks', tracks: [], shortfall: 1 }),
      takeMyMixDemandObservations: jest.fn().mockReturnValue([{
        laneId: 'lane_jazz',
        requested: 1,
        genres: ['Jazz'],
        moods: [],
        matchedTrackIds: [],
      }]),
    };
    const { service } = makeService(runtimeService, undefined, new UnmetDemandService());
    const session = await service.startSession({ userId: `${TEST_PREFIX}user`, budgetCapUsd: 10 });

    await expect(service.agentNext({
      sessionId: session.id,
      userId: `${TEST_PREFIX}user`,
    })).resolves.toMatchObject({ status: 'no_tracks' });

    const observations = await prisma.demandObservation.findMany({
      where: { userId: `${TEST_PREFIX}user`, sourceType: 'session' },
    });
    expect(observations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        targetType: 'genre',
        targetId: JAZZ_ARTIST,
        targetArtistId: JAZZ_ARTIST,
        evidenceTrackId: JAZZ_TRACK,
        value: 'Jazz',
      }),
    ]));
    expect(JSON.stringify(observations)).not.toContain(session.id);
  });

  it('resolves allowExplicit server-side for every next pick (#2088)', async () => {
    const userId = `${TEST_PREFIX}user`;
    const runtimeService = {
      runCommerce: jest.fn().mockResolvedValue({ status: 'no_tracks', tracks: [], shortfall: 1 }),
    };
    const { service } = makeService(runtimeService);
    const session = await service.startSession({ userId, budgetCapUsd: 10 });
    const sentAllowExplicit = () =>
      runtimeService.runCommerce.mock.calls.at(-1)?.[0].preferences.allowExplicit;
    await prisma.agentConfig.create({ data: { userId } });
    try {
      // No saved choice: the safe default excludes explicit tracks.
      await service.agentNext({ sessionId: session.id, userId });
      expect(sentAllowExplicit()).toBe(false);

      // Toggling the saved choice takes effect on the very next pick.
      await prisma.agentConfig.update({ where: { userId }, data: { allowExplicit: true } });
      await service.agentNext({ sessionId: session.id, userId });
      expect(sentAllowExplicit()).toBe(true);

      // A value the session sends itself wins, and is remembered for later picks.
      await service.agentNext({ sessionId: session.id, userId, preferences: { allowExplicit: false } });
      expect(sentAllowExplicit()).toBe(false);
      await service.agentNext({ sessionId: session.id, userId });
      expect(sentAllowExplicit()).toBe(false);
    } finally {
      await prisma.agentConfig.deleteMany({ where: { userId } });
    }
  });

  it('routes agentNext through AgentRuntimeService with session budget and recent tracks', async () => {
    const runtimeService = {
      runCommerce: jest.fn().mockResolvedValue({
        status: 'approved',
        tracks: [
          {
            trackId: `${TEST_PREFIX}track`,
            licenseType: 'remix',
            priceUsd: 5,
            reason: 'within_budget',
          },
        ],
        primaryTrack: {
          trackId: `${TEST_PREFIX}track`,
          licenseType: 'remix',
          priceUsd: 5,
          reason: 'within_budget',
        },
      }),
    };
    const { service } = makeService(runtimeService);
    const session = await service.startSession({
      userId: `${TEST_PREFIX}user`,
      budgetCapUsd: 10,
      preferences: { genres: ['electronic'] },
    });

    const first = await service.agentNext({
      sessionId: session.id,
      userId: `${TEST_PREFIX}user`,
      preferences: { licenseType: 'remix' },
    }) as any;
    const second = await service.agentNext({ sessionId: session.id, userId: `${TEST_PREFIX}user` }) as any;

    expect(first.status).toBe('ok');
    expect(first.track?.id).toBe(`${TEST_PREFIX}track`);
    expect(first.licenseType).toBe('remix');
    expect(first.priceUsd).toBe(5);
    expect(runtimeService.runCommerce).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        sessionId: session.id,
        userId: `${TEST_PREFIX}user`,
        recentTrackIds: [],
        budgetRemainingUsd: 10,
        // The session's own genres travel separately so they outrank learned taste (#2059).
        preferences: { allowExplicit: false, genres: ['electronic'], licenseType: 'remix', sessionGenres: ['electronic'] },
      }),
    );
    expect(runtimeService.runCommerce).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        recentTrackIds: [`${TEST_PREFIX}track`],
        // The session's own genres travel separately so they outrank learned taste (#2059).
        preferences: { allowExplicit: false, genres: ['electronic'], licenseType: 'remix', sessionGenres: ['electronic'] },
      }),
    );
    expect(second.status).toBe('ok');
    // Next picks join the session history once each, like session-start picks.
    const licenses = await prisma.license.findMany({ where: { sessionId: session.id } });
    expect(licenses.map((license) => license.trackId)).toEqual([`${TEST_PREFIX}track`]);
    // The pick log, not a purchase: never priced, whatever the runtime reported.
    expect(licenses[0]).toMatchObject({ type: 'remix', priceUsd: 0, durationSeconds: 0 });
  });

  it('skips next-pick ids the catalog does not hold', async () => {
    const runtimeService = {
      runCommerce: jest.fn().mockResolvedValue({
        status: 'approved',
        tracks: [
          { trackId: `${TEST_PREFIX}track`, licenseType: 'personal', priceUsd: 0 },
          { trackId: `${TEST_PREFIX}missing`, licenseType: 'personal', priceUsd: 0 },
        ],
        primaryTrack: { trackId: `${TEST_PREFIX}track`, licenseType: 'personal', priceUsd: 0 },
      }),
    };
    const { service } = makeService(runtimeService);
    const session = await service.startSession({ userId: `${TEST_PREFIX}user`, budgetCapUsd: 10 });

    const result = await service.agentNext({ sessionId: session.id, userId: `${TEST_PREFIX}user` }) as any;

    expect(result.status).toBe('ok');
    const licenses = await prisma.license.findMany({ where: { sessionId: session.id } });
    expect(licenses.map((license) => license.trackId)).toEqual([`${TEST_PREFIX}track`]);
  });

  it('searches learned genres and excludes the tracks session start picked', async () => {
    const runtimeService = {
      runCommerce: jest.fn().mockResolvedValue({ status: 'no_tracks', tracks: [], shortfall: 5 }),
    };
    const agentLearningService = {
      resolveTasteProfile: jest.fn().mockResolvedValue({ favoredGenres: ['hip hop'], genreWeights: { 'hip hop': 1 } }),
      mergeLearnedGenres: (vibes: string[], profile: { favoredGenres: string[] }, sessionGenres: string[] = []) =>
        Array.from(new Set([...profile.favoredGenres, ...vibes, ...sessionGenres])),
    };
    const { service } = makeService(runtimeService, agentLearningService);
    const session = await service.startSession({ userId: `${TEST_PREFIX}user`, budgetCapUsd: 10 });
    // Session start records its picks as licenses (AgentConfigController.startSession).
    await prisma.license.create({
      data: { sessionId: session.id, trackId: `${TEST_PREFIX}track`, type: 'personal', priceUsd: 0, durationSeconds: 0 },
    });

    const result = await service.agentNext({
      sessionId: session.id,
      userId: `${TEST_PREFIX}user`,
      preferences: { genres: ['Ambient', 'Lo-fi'], mood: 'Focus' },
    }) as any;

    expect(result.status).toBe('no_tracks');
    expect(runtimeService.runCommerce).toHaveBeenCalledWith(
      expect.objectContaining({
        recentTrackIds: [`${TEST_PREFIX}track`],
        preferences: expect.objectContaining({ genres: ['hip hop', 'Ambient', 'Lo-fi'], mood: 'Focus' }),
      }),
    );
  });

  it('records next picks priced 0 and records no taste signal', async () => {
    const runtimeService = {
      runCommerce: jest.fn().mockResolvedValue({
        status: 'approved',
        tracks: [{ trackId: `${TEST_PREFIX}track`, licenseType: 'personal', priceUsd: 0.02, reason: 'selected' }],
        primaryTrack: { trackId: `${TEST_PREFIX}track`, licenseType: 'personal', priceUsd: 0.02, reason: 'selected' },
      }),
    };
    const agentLearningService = {
      resolveTasteProfile: jest.fn().mockResolvedValue({ favoredGenres: [], genreWeights: {} }),
      mergeLearnedGenres: (vibes: string[], profile: { favoredGenres: string[] }, sessionGenres: string[] = []) =>
        Array.from(new Set([...profile.favoredGenres, ...vibes, ...sessionGenres])),
      recordSignal: jest.fn(),
    };
    const { service } = makeService(runtimeService, agentLearningService);
    const session = await service.startSession({ userId: `${TEST_PREFIX}user`, budgetCapUsd: 10 });

    const result = await service.agentNext({ sessionId: session.id, userId: `${TEST_PREFIX}user` }) as any;

    expect(result.status).toBe('ok');
    const licenses = await prisma.license.findMany({ where: { sessionId: session.id } });
    expect(licenses).toHaveLength(1);
    expect(licenses[0]).toMatchObject({ priceUsd: 0, durationSeconds: 0 });
    expect(agentLearningService.recordSignal).not.toHaveBeenCalled();
    expect(await prisma.agentSignal.count({ where: { sessionId: session.id } })).toBe(0);
  });

  it('keeps the session genres and saved vibes in the next-pick search', async () => {
    const runtimeService = {
      runCommerce: jest.fn().mockResolvedValue({ status: 'no_tracks', tracks: [], shortfall: 5 }),
    };
    const agentLearningService = {
      resolveTasteProfile: jest.fn().mockResolvedValue({ favoredGenres: ['hip hop'], genreWeights: {} }),
      mergeLearnedGenres: (vibes: string[], profile: { favoredGenres: string[] }, sessionGenres: string[] = []) =>
        Array.from(new Set([...profile.favoredGenres, ...vibes, ...sessionGenres])),
    };
    await prisma.agentConfig.create({
      data: { userId: `${TEST_PREFIX}user`, vibes: ['Focus'], monthlyCapUsd: 10 },
    });
    try {
      const { service } = makeService(runtimeService, agentLearningService);
      const session = await service.startSession({ userId: `${TEST_PREFIX}user`, budgetCapUsd: 10 });

      await service.agentNext({ sessionId: session.id, userId: `${TEST_PREFIX}user`, preferences: { genres: ['Dark', 'Industrial'] } });

      expect(runtimeService.runCommerce).toHaveBeenCalledWith(
        expect.objectContaining({
          preferences: expect.objectContaining({ genres: ['hip hop', 'Focus', 'Dark', 'Industrial'] }),
        }),
      );
      const config = await prisma.agentConfig.findUnique({ where: { userId: `${TEST_PREFIX}user` } });
      expect(config?.vibes).toEqual(['Focus']);
    } finally {
      await prisma.agentConfig.deleteMany({ where: { userId: `${TEST_PREFIX}user` } });
    }
  });

  it('applies a described request to the next pick, reports its coverage, and a new request replaces the old one (#2037)', async () => {
    const requestCoverage = { picks: 1, gaps: [{ filter: 'bpm', matched: 0 }] };
    const runtimeService = {
      runCommerce: jest.fn().mockResolvedValue({
        status: 'approved',
        tracks: [{ trackId: `${TEST_PREFIX}track`, licenseType: 'personal', priceUsd: 0 }],
        primaryTrack: { trackId: `${TEST_PREFIX}track`, licenseType: 'personal', priceUsd: 0 },
        requestCoverage,
      }),
    };
    const { service } = makeService(runtimeService);
    const session = await service.startSession({ userId: `${TEST_PREFIX}user`, budgetCapUsd: 10 });
    const request = {
      genres: ['Deep House'],
      moods: ['Dark', 'Moody'],
      energy: 'high' as const,
      bpm: { min: 120, max: 125 },
    };

    const first = await service.agentNext({
      sessionId: session.id,
      userId: `${TEST_PREFIX}user`,
      preferences: { genres: ['Soul'], mood: 'Chill', energy: 'low', request },
    }) as any;

    expect(first.requestCoverage).toEqual(requestCoverage);
    expect(runtimeService.runCommerce).toHaveBeenLastCalledWith(
      expect.objectContaining({
        preferences: expect.objectContaining({
          genres: ['Soul', 'Deep House'],
          mood: 'Chill',
          moods: ['Dark', 'Moody'],
          energy: 'high',
          tempoBpm: { min: 120, max: 125 },
          request,
        }),
      }),
    );

    // A new request replaces the old one (a mid-session chip edit re-plans).
    await service.agentNext({
      sessionId: session.id,
      userId: `${TEST_PREFIX}user`,
      preferences: { request: { genres: ['Techno'], moods: [], energy: null, bpm: null } },
    });
    const replaced = runtimeService.runCommerce.mock.calls[1][0].preferences;
    expect(replaced.genres).toEqual(['Soul', 'Techno']);
    expect(replaced.request).toEqual({ genres: ['Techno'], moods: [], energy: null, bpm: null });
    expect(replaced).not.toHaveProperty('tempoBpm');

    // Omitting the request keeps it; sending one with no valid filter clears it.
    await service.agentNext({ sessionId: session.id, userId: `${TEST_PREFIX}user` });
    expect(runtimeService.runCommerce.mock.calls[2][0].preferences.genres).toEqual(['Soul', 'Techno']);
    await service.agentNext({ sessionId: session.id, userId: `${TEST_PREFIX}user`, preferences: { request: { genres: 'junk' } as any } });
    const cleared = runtimeService.runCommerce.mock.calls[3][0].preferences;
    expect(cleared.genres).toEqual(['Soul']);
    expect(cleared.request).toBeUndefined();
    expect(cleared).not.toHaveProperty('moods');
  });

  it('leaves the response without requestCoverage when the runtime reports none (#2037)', async () => {
    const runtimeService = {
      runCommerce: jest.fn().mockResolvedValue({
        status: 'approved',
        tracks: [{ trackId: `${TEST_PREFIX}track`, licenseType: 'personal', priceUsd: 0 }],
        primaryTrack: { trackId: `${TEST_PREFIX}track`, licenseType: 'personal', priceUsd: 0 },
      }),
    };
    const { service } = makeService(runtimeService);
    const session = await service.startSession({ userId: `${TEST_PREFIX}user`, budgetCapUsd: 10 });

    const result = await service.agentNext({ sessionId: session.id, userId: `${TEST_PREFIX}user` }) as any;

    expect(result.status).toBe('ok');
    expect(result).not.toHaveProperty('requestCoverage');
  });

  it('returns only current stems in playlist track summaries', async () => {
    const currentStemId = `${TEST_PREFIX}current_stem`;
    const historicalStemId = `${TEST_PREFIX}historical_stem`;
    await prisma.stem.createMany({
      data: [
        {
          id: currentStemId,
          trackId: `${TEST_PREFIX}track`,
          type: 'vocals',
          uri: '/test/current-vocals.mp3',
          isCurrent: true,
        },
        {
          id: historicalStemId,
          trackId: `${TEST_PREFIX}track`,
          type: 'vocals',
          uri: '/test/historical-vocals.mp3',
          isCurrent: false,
        },
      ],
    });

    const { service } = makeService();
    const playlist = await service.getPlaylist(50);
    const track = (playlist.items as any[]).find(
      (item) => item.id === `${TEST_PREFIX}track`,
    );

    expect(track?.stems.map((stem: { id: string }) => stem.id)).toEqual([
      currentStemId,
    ]);
  });
});
