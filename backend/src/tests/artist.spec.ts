/**
 * Artist Service — Infra-backed Tests
 *
 * Tests ArtistService against a real Postgres database (no mocks).
 * Validates profile creation, retrieval, duplicate prevention, and auto-user creation.
 *
 * Requires: make dev-up (Postgres at localhost:5432)
 * Run: npm run test:integration
 */

import { PrismaClient } from '@prisma/client';
import { ArtistService } from '../modules/artist/artist.service';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://resonate:resonate@localhost:5432/resonate';

let prisma: PrismaClient;
let service: ArtistService;
let dbAvailable = false;

const TEST_PREFIX = `art_infra_${Date.now()}_`;

async function isPostgresAvailable(): Promise<boolean> {
  try {
    const p = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
    await p.$connect();
    await p.$disconnect();
    return true;
  } catch {
    return false;
  }
}

describe('ArtistService (infra-backed)', () => {
  beforeAll(async () => {
    dbAvailable = await isPostgresAvailable();
    if (!dbAvailable) {
      console.warn('⚠️  Postgres not available. Start with: make dev-up');
      return;
    }

    prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
    await prisma.$connect();
    service = new ArtistService();

    // Seed a user for most tests
    await prisma.user.upsert({
      where: { id: `${TEST_PREFIX}user` },
      update: {},
      create: { id: `${TEST_PREFIX}user`, email: `${TEST_PREFIX}user@test.resonate` },
    });
  });

  afterAll(async () => {
    if (!dbAvailable) return;
    try {
      await prisma.artist.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
      await prisma.user.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    } catch (err) {
      console.warn('Cleanup warning:', err);
    }
    await prisma.$disconnect();
  });

  it('creates an artist profile linked to existing user', async () => {
    if (!dbAvailable) return;

    const artist = await service.createProfile(`${TEST_PREFIX}user`, {
      displayName: 'Real DB Artist',
      payoutAddress: '0x' + 'B'.repeat(40),
    });

    expect(artist.id).toBeDefined();
    expect(artist.displayName).toBe('Real DB Artist');
    expect(artist.userId).toBe(`${TEST_PREFIX}user`);
  });

  it('retrieves profile by userId', async () => {
    if (!dbAvailable) return;

    const profile = await service.getProfile(`${TEST_PREFIX}user`);
    expect(profile).not.toBeNull();
    expect(profile!.displayName).toBe('Real DB Artist');
  });

  it('retrieves artist by ID', async () => {
    if (!dbAvailable) return;

    const profile = await service.getProfile(`${TEST_PREFIX}user`);
    const found = await service.findById(profile!.id);
    expect(found).not.toBeNull();
    expect(found!.displayName).toBe('Real DB Artist');
  });

  it('prevents duplicate artist profiles for same user', async () => {
    if (!dbAvailable) return;

    await expect(
      service.createProfile(`${TEST_PREFIX}user`, {
        displayName: 'Duplicate',
        payoutAddress: '0x' + 'C'.repeat(40),
      }),
    ).rejects.toThrow();
  });

  it('returns null for non-existent user profile', async () => {
    if (!dbAvailable) return;

    const profile = await service.getProfile('nonexistent-user-id');
    expect(profile).toBeNull();
  });

  it('returns null for non-existent artist ID', async () => {
    if (!dbAvailable) return;

    const found = await service.findById('nonexistent-artist-id');
    expect(found).toBeNull();
  });

  it('creates User record automatically if missing', async () => {
    if (!dbAvailable) return;

    const newUserId = `${TEST_PREFIX}auto_user`;

    const artist = await service.createProfile(newUserId, {
      displayName: 'Auto-Created User Artist',
      payoutAddress: '0x' + 'D'.repeat(40),
    });

    expect(artist.userId).toBe(newUserId);

    // Verify User was auto-created
    const user = await prisma.user.findUnique({ where: { id: newUserId } });
    expect(user).not.toBeNull();
  });
});
