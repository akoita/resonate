/**
 * Tier 2 Integration Test — Prisma + Postgres
 *
 * Tests real database operations (no mocked Prisma).
 * Requires: Postgres at localhost:5432, typically from Testcontainers or resonate-iac
 *
 * Run: npm run test:integration
 */

import { PrismaClient } from '@prisma/client';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://resonate:resonate@localhost:5432/resonate';

let prisma: PrismaClient;
let dbAvailable = false;

// Unique prefix to avoid collisions with real data
const TEST_PREFIX = `inttest_${Date.now()}_`;

async function isPostgresAvailable(): Promise<boolean> {
  try {
    const testPrisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
    await testPrisma.$connect();
    await testPrisma.$disconnect();
    return true;
  } catch {
    return false;
  }
}

describe('Prisma + Postgres Integration', () => {
  beforeAll(async () => {
    dbAvailable = await isPostgresAvailable();
    if (!dbAvailable) {
      console.warn('⚠️  Postgres not available. Start Postgres via Testcontainers or the resonate-iac stack.');
      return;
    }
    prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
    await prisma.$connect();
  });

  afterAll(async () => {
    if (!dbAvailable) return;

    // Cleanup test data (order matters for FK constraints)
    try {
      await prisma.stem.deleteMany({ where: { trackId: { startsWith: TEST_PREFIX } } });
      await prisma.track.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
      await prisma.release.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
      await prisma.artist.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
      await prisma.user.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    } catch (err) {
      console.warn('Cleanup warning:', err);
    }
    await prisma.$disconnect();
  });

  it('connects to real Postgres', async () => {
    if (!dbAvailable) {
      console.log('⏭️  Skipping: Postgres not available');
      return;
    }
    const result = await prisma.$queryRaw`SELECT 1 as ok`;
    expect(result).toBeDefined();
  });

  it('creates and reads a User', async () => {
    if (!dbAvailable) return;
    const userId = `${TEST_PREFIX}user_1`;

    const user = await prisma.user.create({
      data: {
        id: userId,
        email: `${userId}@test.resonate`,
      },
    });

    expect(user.id).toBe(userId);

    const found = await prisma.user.findUnique({ where: { id: userId } });
    expect(found).not.toBeNull();
    expect(found!.email).toBe(`${userId}@test.resonate`);
  });

  it('creates Artist with User relation', async () => {
    if (!dbAvailable) return;
    const userId = `${TEST_PREFIX}user_art`;
    const artistId = `${TEST_PREFIX}artist_1`;

    await prisma.user.create({
      data: { id: userId, email: `${userId}@test.resonate` },
    });

    const artist = await prisma.artist.create({
      data: {
        id: artistId,
        userId,
        displayName: 'Integration Test Artist',
        payoutAddress: '0x' + '1'.repeat(40),
      },
    });

    expect(artist.displayName).toBe('Integration Test Artist');

    const found = await prisma.artist.findUnique({ where: { id: artistId } });
    expect(found!.userId).toBe(userId);
  });

  it('creates Release with Tracks and Stems', async () => {
    if (!dbAvailable) return;
    const userId = `${TEST_PREFIX}user_rel`;
    const artistId = `${TEST_PREFIX}artist_rel`;
    const releaseId = `${TEST_PREFIX}release_1`;
    const trackId = `${TEST_PREFIX}track_1`;

    await prisma.user.create({
      data: { id: userId, email: `${userId}@test.resonate` },
    });
    await prisma.artist.create({
      data: {
        id: artistId,
        userId,
        displayName: 'Release Test Artist',
        payoutAddress: '0x' + '2'.repeat(40),
      },
    });

    const release = await prisma.release.create({
      data: {
        id: releaseId,
        title: 'Integration Test Album',
        artistId,
        status: 'draft',
      },
    });
    expect(release.title).toBe('Integration Test Album');

    const track = await prisma.track.create({
      data: {
        id: trackId,
        title: 'Integration Test Track',
        releaseId,
        position: 1,
      },
    });
    expect(track.position).toBe(1);

    const stem = await prisma.stem.create({
      data: {
        trackId,
        type: 'vocals',
        uri: '/test/vocals.mp3',
      },
    });
    expect(stem.type).toBe('vocals');

    // Verify relations work
    const fullRelease = await prisma.release.findUnique({
      where: { id: releaseId },
      include: {
        tracks: { include: { stems: true } },
      },
    });

    expect(fullRelease!.tracks).toHaveLength(1);
    expect(fullRelease!.tracks[0].stems).toHaveLength(1);
    expect(fullRelease!.tracks[0].stems[0].type).toBe('vocals');
  });

  it('enforces unique constraints', async () => {
    if (!dbAvailable) return;
    const userId = `${TEST_PREFIX}user_dup`;

    await prisma.user.create({
      data: { id: userId, email: `${userId}@test.resonate` },
    });

    // Attempting duplicate ID should fail
    await expect(
      prisma.user.create({
        data: { id: userId, email: `${userId}_dup@test.resonate` },
      }),
    ).rejects.toThrow();
  });

  it('enforces FK constraint and allows ordered deletion', async () => {
    if (!dbAvailable) return;
    const userId = `${TEST_PREFIX}user_casc`;
    const artistId = `${TEST_PREFIX}artist_casc`;
    const releaseId = `${TEST_PREFIX}release_casc`;
    const trackId = `${TEST_PREFIX}track_casc`;

    await prisma.user.create({
      data: { id: userId, email: `${userId}@test.resonate` },
    });
    await prisma.artist.create({
      data: {
        id: artistId,
        userId,
        displayName: 'Cascade Test',
        payoutAddress: '0x' + '3'.repeat(40),
      },
    });
    await prisma.release.create({
      data: { id: releaseId, title: 'Cascade Test', artistId, status: 'draft' },
    });
    await prisma.track.create({
      data: { id: trackId, title: 'Constraint Track', releaseId, position: 1 },
    });

    // Schema does NOT have onDelete: Cascade — delete should fail with FK violation
    await expect(
      prisma.release.delete({ where: { id: releaseId } }),
    ).rejects.toThrow();

    // Proper cleanup: delete tracks first, then release
    await prisma.track.delete({ where: { id: trackId } });
    await prisma.release.delete({ where: { id: releaseId } });

    const deletedRelease = await prisma.release.findUnique({ where: { id: releaseId } });
    expect(deletedRelease).toBeNull();
  });
});
