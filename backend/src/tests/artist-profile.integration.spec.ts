/**
 * Artist Profile Edit — Integration Test (Testcontainers)
 *
 * Covers WI-1 of #1419: owner-scoped `updateProfile` (image/bio/social
 * links/website). Runs against real Postgres via Testcontainers — never
 * mock Prisma.
 *
 * Run: npm run test:integration -- --testPathPattern=artist-profile
 */

import { prisma } from '../db/prisma';
import { ArtistService } from '../modules/artist/artist.service';
import { EventBus } from '../modules/shared/event_bus';

const TEST_PREFIX = `artprof_${Date.now()}_`;

let service: ArtistService;
let eventBus: EventBus;

describe('ArtistService.updateProfile (integration)', () => {
  beforeAll(async () => {
    eventBus = new EventBus();
    service = new ArtistService(eventBus);

    await prisma.user.create({
      data: { id: `${TEST_PREFIX}owner`, email: `${TEST_PREFIX}owner@test.resonate` },
    });
    await prisma.user.create({
      data: { id: `${TEST_PREFIX}intruder`, email: `${TEST_PREFIX}intruder@test.resonate` },
    });
  });

  afterAll(async () => {
    await prisma.artist.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } }).catch(() => {});
    eventBus.destroy();
  });

  it('lets the owner update imageUrl/summary/socialLinks/website and persists them', async () => {
    const artist = await service.createProfile(`${TEST_PREFIX}owner`, {
      displayName: 'Profile Owner',
      payoutAddress: '0x' + 'A'.repeat(40),
    });

    const updated = await service.updateProfile(`${TEST_PREFIX}owner`, artist.id, {
      imageUrl: 'https://cdn.example.com/artist.png',
      summary: '  A short bio.  ',
      socialLinks: {
        x: 'https://x.com/someartist',
        instagram: 'https://instagram.com/someartist',
      },
      website: 'https://someartist.example.com',
    });

    expect(updated.imageUrl).toBe('https://cdn.example.com/artist.png');
    expect(updated.summary).toBe('A short bio.');
    expect(updated.website).toBe('https://someartist.example.com/');
    expect(updated.socialLinks).toEqual({
      x: 'https://x.com/someartist',
      instagram: 'https://instagram.com/someartist',
    });

    const fetched = await service.findById(artist.id);
    expect(fetched?.imageUrl).toBe('https://cdn.example.com/artist.png');
    expect(fetched?.summary).toBe('A short bio.');
    expect(fetched?.website).toBe('https://someartist.example.com/');
    expect(fetched?.socialLinks).toEqual({
      x: 'https://x.com/someartist',
      instagram: 'https://instagram.com/someartist',
    });
  });

  it('rejects a non-owner with 403 (ForbiddenException) and leaves the profile untouched', async () => {
    const ownedArtist = (await service.getProfile(`${TEST_PREFIX}owner`))!;
    // The intruder must own a *different* artist profile — requireOwnedArtist
    // resolves ownership from the caller's own userId->artist mapping, so a
    // caller with no artist at all would 404, not 403.
    await service.createProfile(`${TEST_PREFIX}intruder`, {
      displayName: 'Intruder',
      payoutAddress: '0x' + 'C'.repeat(40),
    });

    await expect(
      service.updateProfile(`${TEST_PREFIX}intruder`, ownedArtist.id, {
        website: 'https://attacker.example.com',
      }),
    ).rejects.toMatchObject({ status: 403 });

    const fetched = await service.findById(ownedArtist.id);
    expect(fetched?.website).toBe('https://someartist.example.com/');
  });

  it('rejects unsafe URL schemes (javascript:) with 400 (BadRequestException)', async () => {
    const owned = (await service.getProfile(`${TEST_PREFIX}owner`))!;

    await expect(
      service.updateProfile(`${TEST_PREFIX}owner`, owned.id, {
        website: 'javascript:alert(1)',
      }),
    ).rejects.toMatchObject({ status: 400 });

    await expect(
      service.updateProfile(`${TEST_PREFIX}owner`, owned.id, {
        socialLinks: { x: 'data:text/html,<script>alert(1)</script>' },
      }),
    ).rejects.toMatchObject({ status: 400 });

    // Neither rejected call should have mutated the stored value.
    const fetched = await service.findById(owned.id);
    expect(fetched?.website).toBe('https://someartist.example.com/');
  });

  it('persists a partial socialLinks shape (only some platforms set)', async () => {
    const owned = (await service.getProfile(`${TEST_PREFIX}owner`))!;

    const updated = await service.updateProfile(`${TEST_PREFIX}owner`, owned.id, {
      socialLinks: { soundcloud: 'https://soundcloud.com/someartist' },
    });

    expect(updated.socialLinks).toEqual({ soundcloud: 'https://soundcloud.com/someartist' });
  });

  it('does not alter remixConsent when updating the profile', async () => {
    const artist = await service.createProfile(`${TEST_PREFIX}consent_owner`, {
      displayName: 'Consent Owner',
      payoutAddress: '0x' + 'B'.repeat(40),
    });
    expect(artist.remixConsent).toBe('allowed');

    await service.updateProfile(`${TEST_PREFIX}consent_owner`, artist.id, {
      summary: 'Bio without touching consent',
    });

    const fetched = await service.findById(artist.id);
    expect(fetched?.remixConsent).toBe('allowed');
  });
});
