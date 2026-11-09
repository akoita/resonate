/**
 * Source holds on published remixes (#2601, ADR-LD-5 §4) — integration test.
 *
 * Runs against Postgres: the hold is a set of conditional updates and a
 * chain walk, and the restore guard reads the sources inside a transaction.
 *
 * Run: npm run test:integration -- --testPathPattern='remix-source-hold'
 */
import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { prisma } from '../db/prisma';
import { CatalogService } from '../modules/catalog/catalog.service';
import { resolveTrackAvailability } from '../modules/catalog/track-availability';
import { EncryptionService } from '../modules/encryption/encryption.service';
import { AesEncryptionProvider } from '../modules/encryption/providers/aes_encryption_provider';
import { UploadRightsRoutingService } from '../modules/rights/upload-rights-routing.service';
import { EventBus } from '../modules/shared/event_bus';
import { LocalStorageProvider } from '../modules/storage/local_storage_provider';
import { FingerprintService } from '../modules/fingerprint/fingerprint.service';

const P = `rsh_${Date.now()}_`;
const SOURCE_USER = `${P}source_user`;
const OTHER_USER = `${P}other_user`;
const REMIXER = `${P}remixer`;

let catalog: CatalogService;
let eventBus: EventBus;
let holdEvents: any[];
let counter = 0;

async function createUserWithArtist(userId: string) {
  await prisma.user.create({ data: { id: userId, email: `${userId}@test.resonate` } });
  await prisma.artist.create({
    data: {
      id: `${userId}_artist`,
      userId,
      displayName: `${userId} artist`,
      payoutAddress: '0x' + 'A'.repeat(40),
    },
  });
}

/** A published release with one track, owned by `userId`. */
async function createRelease(userId: string, type = 'single') {
  counter += 1;
  const release = await prisma.release.create({
    data: {
      artistId: `${userId}_artist`,
      title: `${P}release ${counter}`,
      status: 'published',
      type,
      rightsRoute: 'STANDARD_ESCROW',
      tracks: { create: { title: `${P}track ${counter}`, processingStatus: 'complete' } },
    },
    include: { tracks: true },
  });
  return { releaseId: release.id, trackId: release.tracks[0].id };
}

/** A published remix by REMIXER of one or two source tracks. */
async function createPublishedRemix(sourceTrackId: string, secondarySourceTrackId?: string) {
  const remix = await createRelease(REMIXER, 'remix');
  const project = await prisma.remixProject.create({
    data: {
      creatorUserId: REMIXER,
      sourceTrackId,
      secondarySourceTrackId: secondarySourceTrackId ?? null,
      title: `${P}remix project ${counter}`,
      status: 'published',
      policyVersion: 'test',
      publishedReleaseId: remix.releaseId,
    },
  });
  return { ...remix, projectId: project.id };
}

async function setConsent(userId: string, remixConsent: 'allowed' | 'disabled') {
  await prisma.artist.update({ where: { id: `${userId}_artist` }, data: { remixConsent } });
  return catalog.reconcileRemixSourceHolds({ artistIds: [`${userId}_artist`] });
}

/** Consent is artist-wide, so earlier tests' remixes change too: keep this test's. */
function only<T extends { releaseId: string }>(changes: T[], releaseIds: string[]): T[] {
  return changes.filter((change) => releaseIds.includes(change.releaseId));
}

function holdState(releaseId: string) {
  return prisma.release.findUniqueOrThrow({
    where: { id: releaseId },
    select: { status: true, statusBeforeWithdrawal: true, sourceHoldReason: true, withdrawnAt: true },
  });
}

describe('Remix source holds (integration, #2601)', () => {
  beforeAll(async () => {
    eventBus = new EventBus();
    const configService = new ConfigService({
      ENCRYPTION_SECRET: process.env.ENCRYPTION_SECRET || 'test-encryption-secret-for-integration',
    });
    const encryption = new EncryptionService(new AesEncryptionProvider(configService) as any, configService);
    catalog = new CatalogService(
      eventBus,
      encryption as any,
      new LocalStorageProvider(),
      new UploadRightsRoutingService(),
    );
    eventBus.subscribe('remix.source_hold_changed', (event: any) => {
      holdEvents.push(event);
    });
    for (const userId of [SOURCE_USER, OTHER_USER, REMIXER]) {
      await createUserWithArtist(userId);
    }
  });

  beforeEach(async () => {
    holdEvents = [];
    await prisma.artist.updateMany({
      where: { id: { startsWith: P } },
      data: { remixConsent: 'allowed' },
    });
  });

  afterAll(async () => {
    await prisma.remixProject.deleteMany({ where: { creatorUserId: { startsWith: P } } });
    await prisma.track.deleteMany({ where: { release: { artistId: { startsWith: P } } } });
    await prisma.release.deleteMany({ where: { artistId: { startsWith: P } } });
    await prisma.artist.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
  });

  it('holds a published remix when the source artist revokes consent, and restores it when consent returns', async () => {
    const source = await createRelease(SOURCE_USER);
    const remix = await createPublishedRemix(source.trackId);

    const held = await setConsent(SOURCE_USER, 'disabled');

    expect(held).toEqual([
      expect.objectContaining({
        releaseId: remix.releaseId,
        remixProjectId: remix.projectId,
        creatorId: REMIXER,
        held: true,
        reason: 'source_consent_revoked',
      }),
    ]);
    expect(await holdState(remix.releaseId)).toMatchObject({
      status: 'withdrawn',
      statusBeforeWithdrawal: 'published',
      sourceHoldReason: 'source_consent_revoked',
    });
    // Libraries and playlists see it as withdrawn, not gone.
    const availability = await resolveTrackAvailability([remix.trackId]);
    expect(availability.get(remix.trackId)).toMatchObject({ state: 'withdrawn' });
    // The source itself is untouched: consent is not a withdrawal.
    expect(await holdState(source.releaseId)).toMatchObject({ status: 'published', sourceHoldReason: null });

    // Running it again changes nothing and announces nothing.
    expect(await catalog.reconcileRemixSourceHolds({ artistIds: [`${SOURCE_USER}_artist`] })).toEqual([]);

    const restored = await setConsent(SOURCE_USER, 'allowed');

    expect(restored).toEqual([
      expect.objectContaining({ releaseId: remix.releaseId, held: false, reason: 'source_consent_revoked' }),
    ]);
    expect(await holdState(remix.releaseId)).toEqual({
      status: 'published',
      statusBeforeWithdrawal: null,
      sourceHoldReason: null,
      withdrawnAt: null,
    });
    expect(holdEvents.map((event) => [event.releaseId, event.held])).toEqual([
      [remix.releaseId, true],
      [remix.releaseId, false],
    ]);
  });

  it('follows the consent event from artist settings', async () => {
    const source = await createRelease(SOURCE_USER);
    const remix = await createPublishedRemix(source.trackId);
    catalog.onModuleInit();

    await prisma.artist.update({ where: { id: `${SOURCE_USER}_artist` }, data: { remixConsent: 'disabled' } });
    eventBus.publish({
      eventName: 'artist.remix_consent_updated',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      artistId: `${SOURCE_USER}_artist`,
      userId: SOURCE_USER,
      previous: 'allowed',
      next: 'disabled',
    });

    for (let attempt = 0; attempt < 50; attempt += 1) {
      if ((await holdState(remix.releaseId)).status === 'withdrawn') break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(await holdState(remix.releaseId)).toMatchObject({
      status: 'withdrawn',
      sourceHoldReason: 'source_consent_revoked',
    });
  });

  it('holds and restores with the source release when its artist withdraws and restores it', async () => {
    const source = await createRelease(SOURCE_USER);
    const remix = await createPublishedRemix(source.trackId);

    await catalog.withdrawRelease(source.releaseId, SOURCE_USER, { reason: 'Re-clearing a sample' });

    expect(await holdState(remix.releaseId)).toMatchObject({
      status: 'withdrawn',
      sourceHoldReason: 'source_withdrawn',
    });
    // The artist's own withdrawal is not a source hold.
    expect(await holdState(source.releaseId)).toMatchObject({ status: 'withdrawn', sourceHoldReason: null });

    await catalog.restoreRelease(source.releaseId, SOURCE_USER);

    expect(await holdState(remix.releaseId)).toMatchObject({ status: 'published', sourceHoldReason: null });
  });

  it('does not let the remixer lift a source hold', async () => {
    const source = await createRelease(SOURCE_USER);
    const remix = await createPublishedRemix(source.trackId);
    await setConsent(SOURCE_USER, 'disabled');

    const attempt = catalog.restoreRelease(remix.releaseId, REMIXER);

    await expect(attempt).rejects.toBeInstanceOf(ConflictException);
    await expect(attempt).rejects.toMatchObject({
      response: { code: 'release_source_hold', reason: 'source_consent_revoked' },
    });
    expect(await holdState(remix.releaseId)).toMatchObject({ status: 'withdrawn' });
  });

  it("keeps the remixer's own withdrawal: no restore while the source blocks, none by the platform after", async () => {
    const source = await createRelease(SOURCE_USER);
    const remix = await createPublishedRemix(source.trackId);
    await catalog.withdrawRelease(remix.releaseId, REMIXER, { reason: 'Fixing the mix' });

    expect(only(await setConsent(SOURCE_USER, 'disabled'), [remix.releaseId])).toEqual([]);
    expect(await holdState(remix.releaseId)).toMatchObject({ status: 'withdrawn', sourceHoldReason: null });
    await expect(catalog.restoreRelease(remix.releaseId, REMIXER)).rejects.toMatchObject({
      response: { code: 'release_source_hold' },
    });

    expect(only(await setConsent(SOURCE_USER, 'allowed'), [remix.releaseId])).toEqual([]);
    expect(await holdState(remix.releaseId)).toMatchObject({ status: 'withdrawn', sourceHoldReason: null });

    await catalog.restoreRelease(remix.releaseId, REMIXER);
    expect(await holdState(remix.releaseId)).toMatchObject({ status: 'published' });
  });

  it('holds a mashup when either source is affected and restores it only when both are clear', async () => {
    const leading = await createRelease(SOURCE_USER);
    const second = await createRelease(OTHER_USER);
    const mashup = await createPublishedRemix(leading.trackId, second.trackId);

    await setConsent(OTHER_USER, 'disabled');
    expect(await holdState(mashup.releaseId)).toMatchObject({
      status: 'withdrawn',
      sourceHoldReason: 'source_consent_revoked',
    });

    await catalog.withdrawRelease(leading.releaseId, SOURCE_USER);
    await setConsent(OTHER_USER, 'allowed');
    // The second source is clear again, the leading one is not.
    expect(await holdState(mashup.releaseId)).toMatchObject({
      status: 'withdrawn',
      sourceHoldReason: 'source_withdrawn',
    });

    await catalog.restoreRelease(leading.releaseId, SOURCE_USER);
    expect(await holdState(mashup.releaseId)).toMatchObject({ status: 'published', sourceHoldReason: null });
  });

  it('holds a remix whose source track is quarantined, and prefers a takedown as the reason', async () => {
    const source = await createRelease(SOURCE_USER);
    const remix = await createPublishedRemix(source.trackId);
    await prisma.artist.update({ where: { id: `${SOURCE_USER}_artist` }, data: { remixConsent: 'disabled' } });

    await prisma.track.update({ where: { id: source.trackId }, data: { contentStatus: 'quarantined' } });
    await catalog.reconcileRemixSourceHolds({ trackIds: [source.trackId] });
    expect(await holdState(remix.releaseId)).toMatchObject({
      status: 'withdrawn',
      sourceHoldReason: 'source_under_review',
    });

    await prisma.track.update({ where: { id: source.trackId }, data: { contentStatus: 'dmca_removed' } });
    expect(await catalog.reconcileRemixSourceHolds({ trackIds: [source.trackId] })).toEqual([]);
    expect(await holdState(remix.releaseId)).toMatchObject({
      status: 'withdrawn',
      sourceHoldReason: 'source_removed',
    });
  });

  it('is triggered by a fingerprint quarantine', async () => {
    const original = await createRelease(OTHER_USER);
    const source = await createRelease(SOURCE_USER);
    const remix = await createPublishedRemix(source.trackId);
    const fingerprints = new FingerprintService(
      { syncTrackRightsFromContentStatus: jest.fn().mockResolvedValue(undefined) } as any,
      eventBus,
    );
    const fingerprint = `${P}same-audio`;
    await prisma.audioFingerprint.create({
      data: { trackId: original.trackId, fingerprint, fingerprintHash: fingerprint, duration: 10 },
    });

    try {
      const result = await fingerprints.registerFingerprint({
        trackId: source.trackId,
        fingerprint,
        fingerprintHash: fingerprint,
        duration: 10,
      } as any);

      expect(result.quarantined).toBe(true);
      expect(await holdState(remix.releaseId)).toMatchObject({
        status: 'withdrawn',
        sourceHoldReason: 'source_under_review',
      });
      expect(only(holdEvents, [remix.releaseId])).toEqual([
        expect.objectContaining({ releaseId: remix.releaseId, held: true, reason: 'source_under_review' }),
      ]);
    } finally {
      await prisma.audioFingerprint.deleteMany({ where: { fingerprintHash: fingerprint } });
    }
  });

  it('follows the chain: a remix of a held remix is held and restored with it', async () => {
    const source = await createRelease(SOURCE_USER);
    const remix = await createPublishedRemix(source.trackId);
    const remixOfRemix = await createPublishedRemix(remix.trackId);

    const held = await setConsent(SOURCE_USER, 'disabled');

    const mine = [remix.releaseId, remixOfRemix.releaseId];
    expect(only(held, mine).map((change) => [change.releaseId, change.reason])).toEqual([
      [remix.releaseId, 'source_consent_revoked'],
      [remixOfRemix.releaseId, 'source_withdrawn'],
    ]);

    const restored = await setConsent(SOURCE_USER, 'allowed');

    expect(only(restored, mine).map((change) => change.releaseId)).toEqual(mine);
    expect(await holdState(remixOfRemix.releaseId)).toMatchObject({ status: 'published', sourceHoldReason: null });
  });

  it('leaves drafts and unrelated remixes alone', async () => {
    const source = await createRelease(SOURCE_USER);
    const unrelatedSource = await createRelease(OTHER_USER);
    const unrelated = await createPublishedRemix(unrelatedSource.trackId);
    const draft = await prisma.remixProject.create({
      data: { creatorUserId: REMIXER, sourceTrackId: source.trackId, title: `${P}draft`, policyVersion: 'test' },
    });

    const changes = await setConsent(SOURCE_USER, 'disabled');

    expect(only(changes, [unrelated.releaseId])).toEqual([]);
    expect(await holdState(unrelated.releaseId)).toMatchObject({ status: 'published', sourceHoldReason: null });
    expect(await prisma.remixProject.findUnique({ where: { id: draft.id } })).toMatchObject({ status: 'draft' });
  });
});
