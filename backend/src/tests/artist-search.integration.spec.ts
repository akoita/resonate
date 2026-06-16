/**
 * Artist Search — Integration Test (Testcontainers)
 *
 * Tests ArtistService.searchByName against real Postgres via Testcontainers.
 * This typeahead is the duplicate-prevention guard for the upload/publish
 * studio: it must surface the canonical spelling of an existing artist so the
 * studio reuses it instead of minting a near-duplicate profile.
 *
 * Run: npm run test:integration
 */

import { prisma } from '../db/prisma';
import { ArtistService } from '../modules/artist/artist.service';
import { EventBus } from '../modules/shared/event_bus';

const TEST_PREFIX = `artsearch_${Date.now()}_`;

let service: ArtistService;

async function seedArtist(suffix: string, data: {
  displayName: string;
  profileType?: string;
  claimStatus?: string;
  imageUrl?: string;
}) {
  return prisma.artist.create({
    data: {
      id: `${TEST_PREFIX}${suffix}`,
      displayName: data.displayName,
      profileType: data.profileType ?? 'manager',
      claimStatus: data.claimStatus ?? 'claimed',
      imageUrl: data.imageUrl,
    },
  });
}

describe('ArtistService.searchByName (integration)', () => {
  beforeAll(async () => {
    service = new ArtistService(new EventBus());
    // Unique-enough names so substring matches don't collide with other suites.
    await seedArtist('bouba', { displayName: `${TEST_PREFIX}Bouba`, imageUrl: 'https://img/bouba.png' });
    await seedArtist('boubacar', { displayName: `${TEST_PREFIX}Boubacar Keita` });
    await seedArtist('calista', { displayName: `${TEST_PREFIX}Calista`, profileType: 'public_artist', claimStatus: 'unclaimed' });
    // Duplicate name across two profiles: an unclaimed public stub and a claimed
    // managed profile. Dedupe must keep the claimed one.
    await seedArtist('dup_unclaimed', { displayName: `${TEST_PREFIX}DupName`, profileType: 'public_artist', claimStatus: 'unclaimed' });
    await seedArtist('dup_claimed', { displayName: `${TEST_PREFIX}DupName`, profileType: 'manager', claimStatus: 'claimed' });
  });

  afterAll(async () => {
    await prisma.artist.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } }).catch(() => {});
  });

  it('returns nothing for an empty/whitespace query (no full-table dump)', async () => {
    expect(await service.searchByName('')).toEqual([]);
    expect(await service.searchByName('   ')).toEqual([]);
  });

  it('matches case-insensitively on a substring', async () => {
    const results = await service.searchByName(`${TEST_PREFIX}bouba`);
    const names = results.map((r) => r.displayName);
    expect(names).toContain(`${TEST_PREFIX}Bouba`);
    expect(names).toContain(`${TEST_PREFIX}Boubacar Keita`);
  });

  it('ranks an exact match above a longer prefix match', async () => {
    const results = await service.searchByName(`${TEST_PREFIX}Bouba`);
    expect(results[0].displayName).toBe(`${TEST_PREFIX}Bouba`);
  });

  it('dedupes profiles that share a name, keeping the claimed one', async () => {
    const results = await service.searchByName(`${TEST_PREFIX}DupName`);
    const dupMatches = results.filter((r) => r.displayName === `${TEST_PREFIX}DupName`);
    expect(dupMatches).toHaveLength(1);
    expect(dupMatches[0].claimStatus).toBe('claimed');
  });

  it('exposes only safe public-facing fields and honours the limit', async () => {
    const results = await service.searchByName(`${TEST_PREFIX}`, 2);
    expect(results.length).toBeLessThanOrEqual(2);
    for (const r of results) {
      expect(Object.keys(r).sort()).toEqual(
        ['claimStatus', 'displayName', 'id', 'imageUrl', 'profileType'].sort(),
      );
    }
  });
});
