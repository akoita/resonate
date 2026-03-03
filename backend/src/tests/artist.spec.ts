/**
 * ArtistService unit tests — Issue #362
 *
 * Tests artist profile CRUD: getProfile, findById, createProfile
 * with duplicate prevention and auto User record creation.
 */

const mockArtists = new Map<string, any>();
const mockUsers = new Map<string, any>();

jest.mock('../db/prisma', () => ({
  prisma: {
    artist: {
      findUnique: jest.fn(async ({ where }: any) => {
        if (where.userId) {
          return Array.from(mockArtists.values()).find(a => a.userId === where.userId) ?? null;
        }
        return mockArtists.get(where.id) ?? null;
      }),
      create: jest.fn(async ({ data }: any) => {
        const id = `artist-${mockArtists.size + 1}`;
        const record = { id, ...data };
        mockArtists.set(id, record);
        return record;
      }),
    },
    user: {
      upsert: jest.fn(async ({ where, create }: any) => {
        const existing = mockUsers.get(where.id);
        if (existing) return existing;
        const record = { ...create };
        mockUsers.set(where.id, record);
        return record;
      }),
    },
  },
}));

import { ArtistService } from '../modules/artist/artist.service';

describe('ArtistService', () => {
  let service: ArtistService;

  beforeEach(() => {
    mockArtists.clear();
    mockUsers.clear();
    service = new ArtistService();
  });

  describe('getProfile', () => {
    it('returns null when no profile exists', async () => {
      const result = await service.getProfile('user-no-profile');
      expect(result).toBeNull();
    });

    it('returns existing profile', async () => {
      mockArtists.set('artist-existing', {
        id: 'artist-existing',
        userId: 'user-1',
        displayName: 'DJ Test',
        payoutAddress: '0xABC',
      });
      const result = await service.getProfile('user-1');
      expect(result!.displayName).toBe('DJ Test');
    });
  });

  describe('findById', () => {
    it('returns null for non-existent artist', async () => {
      const result = await service.findById('nonexistent');
      expect(result).toBeNull();
    });

    it('returns artist by id', async () => {
      mockArtists.set('artist-abc', {
        id: 'artist-abc',
        userId: 'user-1',
        displayName: 'Found Artist',
      });
      const result = await service.findById('artist-abc');
      expect(result!.displayName).toBe('Found Artist');
    });
  });

  describe('createProfile', () => {
    it('creates a new artist profile', async () => {
      const result = await service.createProfile('user-new', {
        displayName: 'New Artist',
        payoutAddress: '0xDEAD',
      });
      expect(result.displayName).toBe('New Artist');
      expect(result.userId).toBe('user-new');
    });

    it('auto-creates User record', async () => {
      await service.createProfile('user-wallet', {
        displayName: 'Wallet Artist',
        payoutAddress: '0xBEEF',
      });
      expect(mockUsers.has('user-wallet')).toBe(true);
    });

    it('throws when profile already exists', async () => {
      mockArtists.set('existing', {
        id: 'existing',
        userId: 'user-dupe',
        displayName: 'Already Here',
      });
      await expect(
        service.createProfile('user-dupe', {
          displayName: 'Duplicate',
          payoutAddress: '0x...',
        }),
      ).rejects.toThrow('Artist profile already exists');
    });
  });
});
