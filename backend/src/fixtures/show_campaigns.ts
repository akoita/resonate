import { existsSync, readFileSync } from "fs";
import { extname, resolve } from "path";
import type { PrismaClient } from "@prisma/client";
import type { StorageProvider } from "../modules/storage/storage_provider";

export type ShowCampaignFixture = {
  artist: {
    id: string;
    displayName: string;
    summary: string;
    socialLinks: Record<string, string>;
    portraitAsset?: string;
  };
  campaign: {
    id: string;
    slug: string;
    title: string;
    city: string;
    country: string;
    venueTarget: string;
    deadlineDays: number;
    targetDays: number;
    bookingDeadlineDays: number;
    goalAmountUnits: string;
    raisedAmountUnits: string;
    minimumBackers: number;
    confirmedPledgeCount: number;
    currency: "EUR" | "USD";
    description: string;
    heroAsset: string;
    cityAsset: string;
  };
  tiers: Array<{
    id: string;
    title: string;
    description: string;
    amountUnits: string;
  }>;
  sources: Array<{ label: string; url: string }>;
};

const standardTiers = (prefix: string): ShowCampaignFixture["tiers"] => [
  {
    id: `sample-${prefix}-fan-signal`,
    title: "Fan signal",
    description: "Refundable support signal and campaign receipt.",
    amountUnits: "25000000",
  },
  {
    id: `sample-${prefix}-ticket-intent`,
    title: "Ticket intent",
    description: "Priority allocation if the concept advances to a confirmed show.",
    amountUnits: "75000000",
  },
  {
    id: `sample-${prefix}-patron-circle`,
    title: "Patron circle",
    description: "Premium campaign receipt and patron allocation.",
    amountUnits: "250000000",
  },
];

export const SHOW_CAMPAIGN_FIXTURES: ShowCampaignFixture[] = [
  {
    artist: {
      id: "sample-artist-sennarin",
      displayName: "SennaRin",
      summary: "Japanese singer, lyricist and illustrator SennaRin emerged through J-pop and anime-song covers before making her solo debut with the 2022 EP Dignified. Her low, expressive voice has become closely associated with cinematic anime themes, including music for Legend of the Galactic Heroes and Bleach: Thousand-Year Blood War.",
      socialLinks: {
        official: "https://www.sennarin.com/",
        musicbrainz: "https://musicbrainz.org/artist/26b8ea1c-fb9e-4378-84a0-d0eace285f7e",
        instagram: "https://www.instagram.com/senna__rin/",
      },
    },
    campaign: {
      id: "sample-show-sennarin-paris",
      slug: "sennarin-paris",
      title: "SennaRin in Paris",
      city: "Paris",
      country: "FR",
      venueTarget: "Le Trianon",
      deadlineDays: 21,
      targetDays: 180,
      bookingDeadlineDays: 52,
      goalAmountUnits: "100000000000",
      raisedAmountUnits: "67200000000",
      minimumBackers: 500,
      confirmedPledgeCount: 127,
      currency: "EUR",
      description: "A cinematic Paris night for a voice built to fill the room. This fan-created concept pairs SennaRin's atmospheric sound with the ornate intimacy of Le Trianon—turning scattered European demand into one visible, refundable signal.",
      heroAsset: "sennarin-paris-hero.jpg",
      cityAsset: "sennarin-paris-venue.jpg",
    },
    tiers: standardTiers("sennarin-paris"),
    sources: [
      { label: "SennaRin official website", url: "https://www.sennarin.com/" },
      { label: "MusicBrainz artist record", url: "https://musicbrainz.org/artist/26b8ea1c-fb9e-4378-84a0-d0eace285f7e" },
      { label: "Wikipedia overview", url: "https://en.wikipedia.org/wiki/SennaRin" },
    ],
  },
  {
    artist: {
      id: "sample-artist-felicia-farerre",
      displayName: "Felicia Farerre",
      summary: "Felicia Farerre is an American recording artist, composer, producer and author whose signature vocal style spans television, advertising, films and movie trailers. Across four decades, her work has moved between intimate songwriting and the large-scale cinematic sound that made her voice familiar to soundtrack audiences.",
      socialLinks: {
        official: "https://www.feliciafarerre.com/",
        musicbrainz: "https://musicbrainz.org/artist/b86942c6-be26-4498-ad50-76fa74a15080",
        youtube: "https://www.youtube.com/@FeliciaFarerre",
      },
    },
    campaign: {
      id: "sample-show-felicia-farerre-dublin",
      slug: "felicia-farerre-dublin",
      title: "Felicia Farerre in Dublin",
      city: "Dublin",
      country: "IE",
      venueTarget: "3Olympia Theatre",
      deadlineDays: 28,
      targetDays: 205,
      bookingDeadlineDays: 60,
      goalAmountUnits: "70000000000",
      raisedAmountUnits: "29400000000",
      minimumBackers: 350,
      confirmedPledgeCount: 94,
      currency: "EUR",
      description: "From trailer-scale power to a pin-drop vocal, Felicia Farerre's music invites a theatrical room. This Dublin concept imagines an intimate, story-led evening at 3Olympia Theatre, backed by a fan signal strong enough to begin a real booking conversation.",
      heroAsset: "felicia-farerre-dublin-hero.jpg",
      cityAsset: "felicia-farerre-dublin-venue.jpg",
    },
    tiers: standardTiers("felicia-farerre-dublin"),
    sources: [
      { label: "Felicia Farerre official website", url: "https://www.feliciafarerre.com/" },
      { label: "MusicBrainz artist record", url: "https://musicbrainz.org/artist/b86942c6-be26-4498-ad50-76fa74a15080" },
      { label: "Apple Music artist record", url: "https://music.apple.com/us/artist/felicia-farerre/493578054" },
    ],
  },
  {
    artist: {
      id: "sample-artist-leona-lewis",
      displayName: "Leona Lewis",
      summary: "London-born singer, songwriter and actress Leona Lewis trained at the BRIT School before winning The X Factor in 2006. Her debut era made her an international pop and soul voice, with the album Spirit and the global reach of Bleeding Love establishing a career defined by range, clarity and emotional scale.",
      socialLinks: {
        official: "https://www.leonalewismusic.com/",
        musicbrainz: "https://musicbrainz.org/artist/8d552dfc-648f-401f-90de-e925013ca537",
        instagram: "https://www.instagram.com/leonalewis/",
      },
      portraitAsset: "leona-lewis-portrait.jpg",
    },
    campaign: {
      id: "sample-show-leona-lewis-lagos",
      slug: "leona-lewis-lagos",
      title: "Leona Lewis in Lagos",
      city: "Lagos",
      country: "NG",
      venueTarget: "Eko Convention Centre",
      deadlineDays: 35,
      targetDays: 225,
      bookingDeadlineDays: 68,
      goalAmountUnits: "120000000000",
      raisedAmountUnits: "45600000000",
      minimumBackers: 650,
      confirmedPledgeCount: 211,
      currency: "USD",
      description: "Lagos deserves the full voice, full band and full-room chorus. This fan-created concept brings Leona Lewis's pop-soul catalogue into a city that knows how to turn a great vocal into a communal event—if the demand signal can make the journey viable.",
      heroAsset: "leona-lewis-lagos-hero.jpg",
      cityAsset: "leona-lewis-lagos-city.jpg",
    },
    tiers: standardTiers("leona-lewis-lagos"),
    sources: [
      { label: "Leona Lewis official website", url: "https://www.leonalewismusic.com/" },
      { label: "MusicBrainz artist record", url: "https://musicbrainz.org/artist/8d552dfc-648f-401f-90de-e925013ca537" },
      { label: "Wikipedia overview", url: "https://en.wikipedia.org/wiki/Leona_Lewis" },
    ],
  },
  {
    artist: {
      id: "sample-artist-aya-nakamura",
      displayName: "Aya Nakamura",
      summary: "Bamako-born French-Malian singer-songwriter Aya Nakamura began sharing music online in 2014 and grew into one of francophone pop's defining international voices. Her 2018 album Nakamura, powered by songs including Djadja and Copines, carried her blend of R&B, Afrobeats and pop far beyond France.",
      socialLinks: {
        official: "https://ayanakamura.com/",
        musicbrainz: "https://musicbrainz.org/artist/cf580d82-3f3e-4b86-8874-7e0fbe794f01",
        instagram: "https://www.instagram.com/ayanakamura_officiel/",
      },
      portraitAsset: "aya-nakamura-portrait.jpg",
    },
    campaign: {
      id: "sample-show-aya-nakamura-montreal",
      slug: "aya-nakamura-montreal",
      title: "Aya Nakamura in Montréal",
      city: "Montréal",
      country: "CA",
      venueTarget: "MTELUS",
      deadlineDays: 18,
      targetDays: 165,
      bookingDeadlineDays: 48,
      goalAmountUnits: "95000000000",
      raisedAmountUnits: "74100000000",
      minimumBackers: 550,
      confirmedPledgeCount: 306,
      currency: "USD",
      description: "Montréal already speaks the language of this show: francophone hooks, Afrobeats pulse and a crowd ready to answer every line. This concept turns that cultural fit into a measurable signal for an electric Aya Nakamura night at MTELUS.",
      heroAsset: "aya-nakamura-montreal-hero.jpg",
      cityAsset: "aya-nakamura-montreal-city.jpg",
    },
    tiers: standardTiers("aya-nakamura-montreal"),
    sources: [
      { label: "Aya Nakamura official website", url: "https://ayanakamura.com/" },
      { label: "MusicBrainz artist record", url: "https://musicbrainz.org/artist/cf580d82-3f3e-4b86-8874-7e0fbe794f01" },
      { label: "Wikipedia overview", url: "https://en.wikipedia.org/wiki/Aya_Nakamura" },
    ],
  },
];

export type ApplyShowCampaignFixturesOptions = {
  assetDirectory: string;
  chainId: number;
  dryRun?: boolean;
  now?: Date;
};

const dateFrom = (now: Date, days: number) => new Date(now.getTime() + days * 86_400_000);

function mimeTypeFor(path: string): string {
  const extension = extname(path).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  throw new Error(`Unsupported show fixture image type: ${extension || "none"}`);
}

export function validateShowCampaignFixtures(assetDirectory: string) {
  const ids = new Set<string>();
  const slugs = new Set<string>();
  for (const fixture of SHOW_CAMPAIGN_FIXTURES) {
    if (ids.has(fixture.campaign.id)) throw new Error(`Duplicate fixture campaign id: ${fixture.campaign.id}`);
    if (slugs.has(fixture.campaign.slug)) throw new Error(`Duplicate fixture campaign slug: ${fixture.campaign.slug}`);
    ids.add(fixture.campaign.id);
    slugs.add(fixture.campaign.slug);
    if (!fixture.artist.summary.trim()) throw new Error(`Missing artist summary: ${fixture.artist.displayName}`);
    if (fixture.sources.length < 2) throw new Error(`Insufficient sources: ${fixture.artist.displayName}`);
    const assetNames = [fixture.campaign.heroAsset, fixture.campaign.cityAsset, fixture.artist.portraitAsset]
      .filter((value): value is string => Boolean(value));
    for (const assetName of assetNames) {
      const path = resolve(assetDirectory, assetName);
      if (!existsSync(path)) throw new Error(`Missing show fixture asset: ${path}`);
      mimeTypeFor(path);
    }
  }
}

export async function applyShowCampaignFixtures(
  prisma: PrismaClient,
  storage: StorageProvider,
  options: ApplyShowCampaignFixturesOptions,
) {
  validateShowCampaignFixtures(options.assetDirectory);
  if (options.dryRun) return { campaigns: SHOW_CAMPAIGN_FIXTURES.length, dryRun: true };

  const now = options.now ?? new Date();
  for (const fixture of SHOW_CAMPAIGN_FIXTURES) {
    const uploadAsset = async (assetName: string) => {
      const path = resolve(options.assetDirectory, assetName);
      const mimeType = mimeTypeFor(path);
      const stored = await storage.upload(
        readFileSync(path),
        `sample-show-${fixture.campaign.slug}-${assetName}`,
        mimeType,
      );
      return { mimeType, storageUri: stored.uri };
    };

    const hero = await uploadAsset(fixture.campaign.heroAsset);
    const city = await uploadAsset(fixture.campaign.cityAsset);
    const portrait = fixture.artist.portraitAsset
      ? await uploadAsset(fixture.artist.portraitAsset)
      : null;
    const heroUrl = `/shows/campaigns/${fixture.campaign.id}/visuals/hero`;
    const cardUrl = `/shows/campaigns/${fixture.campaign.id}/visuals/card`;

    await prisma.artist.upsert({
      where: { id: fixture.artist.id },
      update: {
        displayName: fixture.artist.displayName,
        imageUrl: portrait
          ? `/shows/campaigns/${fixture.campaign.id}/visuals/sample-${fixture.campaign.slug}-portrait`
          : heroUrl,
        summary: fixture.artist.summary,
        socialLinks: fixture.artist.socialLinks,
        profileType: "fixture",
        claimStatus: "unclaimed",
      },
      create: {
        id: fixture.artist.id,
        displayName: fixture.artist.displayName,
        imageUrl: portrait
          ? `/shows/campaigns/${fixture.campaign.id}/visuals/sample-${fixture.campaign.slug}-portrait`
          : heroUrl,
        summary: fixture.artist.summary,
        socialLinks: fixture.artist.socialLinks,
        profileType: "fixture",
        claimStatus: "unclaimed",
      },
    });

    await prisma.showCampaign.upsert({
      where: { id: fixture.campaign.id },
      update: {
        slug: fixture.campaign.slug,
        artistId: fixture.artist.id,
        artistDisplayName: fixture.artist.displayName,
        artistImageUrl: portrait
          ? `/shows/campaigns/${fixture.campaign.id}/visuals/sample-${fixture.campaign.slug}-portrait`
          : heroUrl,
        heroImageUrl: heroUrl,
        heroImageStorageUri: hero.storageUri,
        heroImageMimeType: hero.mimeType,
        cardImageUrl: cardUrl,
        cardImageStorageUri: hero.storageUri,
        cardImageMimeType: hero.mimeType,
        title: fixture.campaign.title,
        description: fixture.campaign.description,
        city: fixture.campaign.city,
        country: fixture.campaign.country,
        venueTarget: fixture.campaign.venueTarget,
        targetDate: dateFrom(now, fixture.campaign.targetDays),
        deadline: dateFrom(now, fixture.campaign.deadlineDays),
        bookingDeadline: dateFrom(now, fixture.campaign.bookingDeadlineDays),
        goalAmountUnits: fixture.campaign.goalAmountUnits,
        raisedAmountUnits: fixture.campaign.raisedAmountUnits,
        minimumBackers: fixture.campaign.minimumBackers,
        confirmedPledgeCount: fixture.campaign.confirmedPledgeCount,
        uniqueBackerCount: fixture.campaign.confirmedPledgeCount,
        currency: fixture.campaign.currency,
        paymentAssetSymbol: "USDC",
        paymentAssetDecimals: 6,
        chainId: options.chainId,
        status: "active",
        campaignLevel: "active_escrow_campaign",
        artistAuthorityStatus: "none",
        metadata: {
          fixture: true,
          fixtureSet: "sample-show-campaigns/v1",
          fictionalCampaign: true,
          artistEndorsed: false,
          venueConfirmed: false,
          sources: fixture.sources,
        },
      },
      create: {
        id: fixture.campaign.id,
        slug: fixture.campaign.slug,
        artistId: fixture.artist.id,
        artistDisplayName: fixture.artist.displayName,
        artistImageUrl: portrait
          ? `/shows/campaigns/${fixture.campaign.id}/visuals/sample-${fixture.campaign.slug}-portrait`
          : heroUrl,
        heroImageUrl: heroUrl,
        heroImageStorageUri: hero.storageUri,
        heroImageMimeType: hero.mimeType,
        cardImageUrl: cardUrl,
        cardImageStorageUri: hero.storageUri,
        cardImageMimeType: hero.mimeType,
        title: fixture.campaign.title,
        description: fixture.campaign.description,
        city: fixture.campaign.city,
        country: fixture.campaign.country,
        venueTarget: fixture.campaign.venueTarget,
        targetDate: dateFrom(now, fixture.campaign.targetDays),
        deadline: dateFrom(now, fixture.campaign.deadlineDays),
        bookingDeadline: dateFrom(now, fixture.campaign.bookingDeadlineDays),
        goalAmountUnits: fixture.campaign.goalAmountUnits,
        raisedAmountUnits: fixture.campaign.raisedAmountUnits,
        minimumBackers: fixture.campaign.minimumBackers,
        confirmedPledgeCount: fixture.campaign.confirmedPledgeCount,
        uniqueBackerCount: fixture.campaign.confirmedPledgeCount,
        currency: fixture.campaign.currency,
        paymentAssetSymbol: "USDC",
        paymentAssetDecimals: 6,
        chainId: options.chainId,
        status: "active",
        campaignLevel: "active_escrow_campaign",
        artistAuthorityStatus: "none",
        metadata: {
          fixture: true,
          fixtureSet: "sample-show-campaigns/v1",
          fictionalCampaign: true,
          artistEndorsed: false,
          venueConfirmed: false,
          sources: fixture.sources,
        },
      },
    });

    await prisma.showCampaignTier.deleteMany({ where: { campaignId: fixture.campaign.id } });
    await prisma.showCampaignTier.createMany({
      data: fixture.tiers.map((tier, sortOrder) => ({
        ...tier,
        campaignId: fixture.campaign.id,
        currency: fixture.campaign.currency,
        paymentAssetSymbol: "USDC",
        paymentAssetDecimals: 6,
        sortOrder,
      })),
    });

    await prisma.showCampaignVisual.deleteMany({ where: { campaignId: fixture.campaign.id } });
    await prisma.showCampaignVisual.createMany({
      data: [
        {
          id: `sample-${fixture.campaign.slug}-hero`,
          campaignId: fixture.campaign.id,
          role: "hero",
          publicUrl: heroUrl,
          storageUri: hero.storageUri,
          mimeType: hero.mimeType,
          sortOrder: 0,
          caption: `${fixture.campaign.title} — original Resonate sample campaign artwork.`,
          credit: "AI-generated campaign concept artwork; not an artist photograph",
        },
        {
          id: `sample-${fixture.campaign.slug}-card`,
          campaignId: fixture.campaign.id,
          role: "card",
          publicUrl: cardUrl,
          storageUri: hero.storageUri,
          mimeType: hero.mimeType,
          sortOrder: 1,
          caption: `${fixture.campaign.title} campaign preview.`,
          credit: "AI-generated campaign concept artwork; not an artist photograph",
        },
        {
          id: `sample-${fixture.campaign.slug}-city`,
          campaignId: fixture.campaign.id,
          role: "gallery",
          publicUrl: `/shows/campaigns/${fixture.campaign.id}/visuals/sample-${fixture.campaign.slug}-city`,
          storageUri: city.storageUri,
          mimeType: city.mimeType,
          sortOrder: 10,
          caption: `${fixture.campaign.venueTarget}, the proposed setting for this fictional campaign.`,
          credit: "Openly licensed source; full attribution in backend/fixtures/show-campaigns/README.md",
        },
        ...(portrait ? [{
          id: `sample-${fixture.campaign.slug}-portrait`,
          campaignId: fixture.campaign.id,
          role: "gallery",
          publicUrl: `/shows/campaigns/${fixture.campaign.id}/visuals/sample-${fixture.campaign.slug}-portrait`,
          storageUri: portrait.storageUri,
          mimeType: portrait.mimeType,
          sortOrder: 11,
          caption: fixture.artist.displayName,
          credit: "Openly licensed artist photograph; full attribution in backend/fixtures/show-campaigns/README.md",
        }] : []),
      ],
    });
  }

  return { campaigns: SHOW_CAMPAIGN_FIXTURES.length, dryRun: false };
}
