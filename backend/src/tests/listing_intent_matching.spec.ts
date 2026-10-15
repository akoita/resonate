/**
 * Per-tier listing-intent matching (#2041) — pure unit tests.
 * DB-backed reconciliation is covered in multi_tier_listing.integration.spec.ts.
 */
import {
  intentsForSeller,
  listingOrdinal,
  matchListingIntent,
  sellerListingOrdinal,
  type MatchableListingIntent,
} from '../modules/contracts/listing-intent-matching';

const intent = (
  licenseType: MatchableListingIntent['licenseType'],
  logOrdinal: number | null,
  listingId: bigint | null = null,
): MatchableListingIntent => ({ licenseType, sellerAddress: null, logOrdinal, listingId });

describe('matchListingIntent', () => {
  it('prefers the intent pinned to the listing id', () => {
    const intents = [intent('personal', 0, 7n), intent('remix', 1, 8n)];
    expect(matchListingIntent(intents, { listingId: 8n, ordinal: 0 })).toEqual({
      intent: intents[1],
      rule: 'listingId',
    });
  });

  it('matches by ordinal when every intent carries one', () => {
    const intents = [intent('commercial', 1), intent('remix', 0)];
    expect(matchListingIntent(intents, { listingId: 3n, ordinal: 0 }).intent).toBe(intents[1]);
    expect(matchListingIntent(intents, { listingId: 4n, ordinal: 1 }).intent).toBe(intents[0]);
  });

  it('does not match by ordinal when an intent lacks one, or the ordinal is unknown', () => {
    expect(matchListingIntent([intent('personal', 0), intent('remix', null)], { listingId: 1n, ordinal: 0 }).intent).toBeNull();
    expect(matchListingIntent([intent('personal', 0), intent('remix', 1)], { listingId: 1n, ordinal: null }).intent).toBeNull();
  });

  it('does not hand a listing an intent pinned to another listing id', () => {
    const intents = [intent('personal', 0, 7n), intent('remix', 1, 8n)];
    expect(matchListingIntent(intents, { listingId: 9n, ordinal: 0 }).intent).toBeNull();
    expect(matchListingIntent([intent('remix', null, 8n)], { listingId: 9n, ordinal: null }).intent).toBeNull();
  });

  it('uses the sole intent of a legacy single-tier notify', () => {
    const legacy = intent('remix', null);
    expect(matchListingIntent([legacy], { listingId: 5n, ordinal: null })).toEqual({ intent: legacy, rule: 'single' });
  });

  it('returns no match without intents', () => {
    expect(matchListingIntent([], { listingId: 5n, ordinal: 0 })).toEqual({ intent: null, rule: null });
  });
});

describe('listingOrdinal', () => {
  it('ranks a listing id among its known siblings', () => {
    expect(listingOrdinal(43n, [41n, 43n])).toBe(1);
    expect(listingOrdinal(41n, [43n, 41n, 41n])).toBe(0);
    expect(listingOrdinal(50n, [])).toBe(0);
  });
});

describe('intentsForSeller', () => {
  it('keeps the on-chain seller own intents (case-insensitive) and pre-#2041 rows without a seller', () => {
    const own = { sellerAddress: '0xabc' };
    const legacy = { sellerAddress: null };
    const foreign = { sellerAddress: '0xdef' };
    expect(intentsForSeller([own, legacy, foreign], '0xABC')).toEqual({ applicable: [own, legacy], foreign: 1 });
  });
});

describe('sellerListingOrdinal', () => {
  it('ranks only among the same seller listings of the token', () => {
    const siblings = [
      { listingId: 10n, sellerAddress: '0xb' },
      { listingId: 11n, sellerAddress: '0xa' },
      { listingId: 12n, sellerAddress: '0xb' },
    ];
    expect(sellerListingOrdinal(12n, '0xB', siblings)).toBe(1);
    expect(sellerListingOrdinal(11n, '0xa', siblings)).toBe(0);
  });
});
