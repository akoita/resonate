/**
 * Artist Service — Integration Test (Testcontainers)
 *
 * Tests ArtistService against real Postgres via Testcontainers.
 * Validates profile creation, retrieval, duplicate prevention, and auto-user creation.
 *
 * Run: npm run test:integration
 */

import { prisma } from '../db/prisma';
import { ArtistService } from '../modules/artist/artist.service';

const TEST_PREFIX = `art_${Date.now()}_`;

let service: ArtistService;

describe('ArtistService (integration)', () => {
  beforeAll(async () => {
    service = new ArtistService();
    await prisma.user.create({
      data: { id: `${TEST_PREFIX}user`, email: `${TEST_PREFIX}user@test.resonate` },
    });
  });

  afterAll(async () => {
    await prisma.artist.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } }).catch(() => {});
  });

  it('creates an artist profile linked to existing user', async () => {
    const artist = await service.createProfile(`${TEST_PREFIX}user`, {
      displayName: 'Real DB Artist',
      payoutAddress: '0x' + 'B'.repeat(40),
    });
    expect(artist.id).toBeDefined();
    expect(artist.displayName).toBe('Real DB Artist');
    expect(artist.userId).toBe(`${TEST_PREFIX}user`);
  });

  it('retrieves profile by userId', async () => {
    const profile = await service.getProfile(`${TEST_PREFIX}user`);
    expect(profile).not.toBeNull();
    expect(profile!.displayName).toBe('Real DB Artist');
  });

  it('retrieves artist by ID', async () => {
    const profile = await service.getProfile(`${TEST_PREFIX}user`);
    const found = await service.findById(profile!.id);
    expect(found).not.toBeNull();
    expect(found!.displayName).toBe('Real DB Artist');
  });

  it('prevents duplicate artist profiles for same user', async () => {
    await expect(
      service.createProfile(`${TEST_PREFIX}user`, {
        displayName: 'Duplicate',
        payoutAddress: '0x' + 'C'.repeat(40),
      }),
    ).rejects.toThrow();
  });

  it('returns null for non-existent user profile', async () => {
    const profile = await service.getProfile('nonexistent-user-id');
    expect(profile).toBeNull();
  });

  it('returns null for non-existent artist ID', async () => {
    const found = await service.findById('nonexistent-artist-id');
    expect(found).toBeNull();
  });

  it('creates User record automatically if missing', async () => {
    const newUserId = `${TEST_PREFIX}auto_user`;
    const artist = await service.createProfile(newUserId, {
      displayName: 'Auto-Created User Artist',
      payoutAddress: '0x' + 'D'.repeat(40),
    });
    expect(artist.userId).toBe(newUserId);

    const user = await prisma.user.findUnique({ where: { id: newUserId } });
    expect(user).not.toBeNull();
  });
});
