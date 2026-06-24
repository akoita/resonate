import { existsSync, readFileSync } from "fs";
import { extname, resolve } from "path";
import type { PrismaClient } from "@prisma/client";
import type { StorageProvider } from "../modules/storage/storage_provider";

export type ShowGalleryAsset = {
  /** Stable suffix for the visual id: `sample-<slug>-<key>`. */
  key: string;
  file: string;
  caption: string;
  credit: string;
};

export type ShowCampaignFixture = {
  artist: {
    id: string;
    displayName: string;
    summary: string;
    socialLinks: Record<string, string>;
    /** Gallery key whose image is used as the artist portrait; falls back to the hero. */
    portraitKey?: string;
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
    /** Credit for the hero/card image; defaults to the generated-art credit. */
    heroCredit?: string;
  };
  /** Immersive gallery images (venue, city, real artist photos/artwork). */
  gallery: ShowGalleryAsset[];
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

/** Credit string for an image owned by the artist/label with no open license (demo use only). */
const OFFICIAL_DEMO_CREDIT = (owner: string, source: string) =>
  `© ${owner} — ${source}; all rights reserved, used for non-commercial demo content only`;

export const SHOW_CAMPAIGN_FIXTURES: ShowCampaignFixture[] = [
  {
    artist: {
      id: "sample-artist-sennarin",
      displayName: "SennaRin",
      summary: "Japanese singer, lyricist and illustrator SennaRin emerged through J-pop and anime-song covers on YouTube before composer Hiroyuki Sawano produced her 2022 debut EP, Dignified. Her expressive low register quickly became a fixture of cinematic anime — 'dust' and 'melt' soundtracked Legend of the Galactic Heroes: Die Neue These, and her single 'Saihate' served as an ending theme for Bleach: Thousand-Year Blood War. Signed to Sony's Sacra Music, she pairs that voice with her own lyrics and artwork.",
      socialLinks: {
        official: "https://www.sennarin.com/",
        instagram: "https://www.instagram.com/senna__rin/",
      },
      portraitKey: "portrait",
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
      heroCredit: OFFICIAL_DEMO_CREDIT("SennaRin / staff", "composed from her official @senna_rin on X photo"),
    },
    gallery: [
      {
        key: "portrait",
        file: "sennarin-portrait.jpg",
        caption: "SennaRin.",
        credit: OFFICIAL_DEMO_CREDIT("SennaRin / staff", "official photo via @senna_rin on X"),
      },
      {
        key: "editorial",
        file: "sennarin-editorial.jpg",
        caption: "SennaRin.",
        credit: OFFICIAL_DEMO_CREDIT("SennaRin / staff", "official photo via @senna_rin on X"),
      },
      {
        key: "band",
        file: "sennarin-band.jpg",
        caption: "SennaRin (centre) with her band.",
        credit: OFFICIAL_DEMO_CREDIT("SennaRin / staff", "official photo via @senna_rin on X"),
      },
      {
        key: "venue",
        file: "sennarin-paris-venue.jpg",
        caption: "Le Trianon, Paris — the proposed setting for this fictional campaign.",
        credit: "Celette, CC BY-SA 4.0 (Wikimedia Commons)",
      },
    ],
    tiers: standardTiers("sennarin-paris"),
    sources: [
      { label: "SennaRin official website", url: "https://www.sennarin.com/" },
      { label: "Wikipedia overview", url: "https://en.wikipedia.org/wiki/SennaRin" },
    ],
  },
  {
    artist: {
      id: "sample-artist-felicia-farerre",
      displayName: "Felicia Farerre",
      summary: "Felicia Farerre is an American vocalist, composer and producer whose four-decade career has made her voice a fixture of film, television and epic trailer music. She is the soaring lead voice on Two Steps from Hell's 'Star Sky' and crowned the Billboard charts as lead vocalist for the classical-crossover Taliesin Orchestra, and her vocals carry trailers for films from Maleficent and 300: Rise of an Empire to Ocean's Twelve. A lyricist, author and vocal coach, she also created the Epic Women project and the Real Singers Don't Sing training program.",
      socialLinks: {
        official: "https://www.feliciafarerre.com/",
        youtube: "https://www.youtube.com/@FeliciaFarerre",
      },
      portraitKey: "portrait",
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
      heroCredit: OFFICIAL_DEMO_CREDIT("Felicia Farerre", "composed from her studio press photo"),
    },
    gallery: [
      {
        key: "portrait",
        file: "felicia-farerre-portrait.jpg",
        caption: "Felicia Farerre.",
        credit: OFFICIAL_DEMO_CREDIT("Felicia Farerre", "\"After Rain\" single cover art"),
      },
      {
        key: "studio",
        file: "felicia-farerre-studio.jpg",
        caption: "Felicia Farerre at the microphone.",
        credit: OFFICIAL_DEMO_CREDIT("Felicia Farerre", "press photo via Crossover Music Magazine"),
      },
      {
        key: "venue",
        file: "felicia-farerre-dublin-venue.jpg",
        caption: "3Olympia Theatre, Dublin — the proposed setting for this fictional campaign.",
        credit: "William Murphy, CC BY-SA 2.0 (Wikimedia Commons)",
      },
    ],
    tiers: standardTiers("felicia-farerre-dublin"),
    sources: [
      { label: "Felicia Farerre official website", url: "https://www.feliciafarerre.com/" },
      { label: "Apple Music artist record", url: "https://music.apple.com/us/artist/felicia-farerre/493578054" },
    ],
  },
  {
    artist: {
      id: "sample-artist-leona-lewis",
      displayName: "Leona Lewis",
      summary: "London-born singer, songwriter and actress Leona Lewis trained at the BRIT School before winning The X Factor in 2006. Her debut album Spirit went 10× platinum in the UK and ranks among the best-selling albums in British chart history, while its single 'Bleeding Love' reached number one in more than thirty countries, including the UK and the US Billboard Hot 100. Three Grammy nominations, a Beijing Olympics closing-ceremony duet with Jimmy Page and over 30 million records sold cemented a pop-soul career defined by range and emotional scale.",
      socialLinks: {
        official: "https://www.leonalewismusic.com/",
        instagram: "https://www.instagram.com/leonalewis/",
      },
      portraitKey: "live",
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
      heroCredit: OFFICIAL_DEMO_CREDIT("Getty Images", "editorial concert photo, Abu Dhabi"),
    },
    gallery: [
      {
        key: "live",
        file: "leona-lewis-live.jpg",
        caption: "Leona Lewis performing live (amfAR Venice, 2023).",
        credit: OFFICIAL_DEMO_CREDIT("Getty Images", "editorial photo, amfAR Venice 2023"),
      },
      {
        key: "vegas",
        file: "leona-lewis-vegas.jpg",
        caption: "Leona Lewis on her Las Vegas Christmas show.",
        credit: OFFICIAL_DEMO_CREDIT("Getty Images", "editorial concert photo, Las Vegas"),
      },
      {
        key: "wimbledon",
        file: "leona-lewis-wimbledon.jpg",
        caption: "Leona Lewis at Wimbledon.",
        credit: OFFICIAL_DEMO_CREDIT("Getty Images", "editorial photo, Wimbledon"),
      },
      {
        key: "city",
        file: "leona-lewis-lagos-city.jpg",
        caption: "Lagos skyline.",
        credit: "SmartAfricanBoy, CC BY-SA 4.0 (Wikimedia Commons)",
      },
    ],
    tiers: standardTiers("leona-lewis-lagos"),
    sources: [
      { label: "Leona Lewis official website", url: "https://www.leonalewismusic.com/" },
      { label: "Wikipedia overview", url: "https://en.wikipedia.org/wiki/Leona_Lewis" },
    ],
  },
  {
    artist: {
      id: "sample-artist-aya-nakamura",
      displayName: "Aya Nakamura",
      summary: "Bamako-born French-Malian singer-songwriter Aya Nakamura is the most-streamed French-language female artist in history. Her 2018 single 'Djadja' topped the French charts, was certified diamond, and became the first video by a female African artist to pass one billion YouTube views — also making her the first French woman to reach number one in the Netherlands since Édith Piaf. Across the diamond-certified Nakamura, the Victoires de la Musique-winning Aya and DNK she has fused R&B, Afrobeats, zouk and pop, and in 2024 she headlined the opening ceremony of the Paris Olympic Games.",
      socialLinks: {
        instagram: "https://www.instagram.com/ayanakamura_officiel/",
      },
      portraitKey: "portrait",
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
      heroCredit: "Composed from a live photo by Mathis.aclr — CC0 / public domain (Wikimedia Commons)",
    },
    gallery: [
      {
        key: "portrait",
        file: "aya-nakamura-portrait.jpg",
        caption: "Aya Nakamura (2024).",
        credit: OFFICIAL_DEMO_CREDIT("Getty Images", "editorial photo, 2024"),
      },
      {
        key: "live",
        file: "aya-nakamura-live.jpg",
        caption: "Aya Nakamura performing (OVO Arena Wembley, 2023).",
        credit: OFFICIAL_DEMO_CREDIT("Getty Images", "editorial concert photo, 2023"),
      },
      {
        key: "stage",
        file: "aya-nakamura-stage.jpg",
        caption: "Aya Nakamura on stage (2023).",
        credit: OFFICIAL_DEMO_CREDIT("Getty Images", "editorial concert photo, 2023"),
      },
      {
        key: "city",
        file: "aya-nakamura-montreal-city.jpg",
        caption: "Montréal at night.",
        credit: "Mathieu Landretti, CC BY-SA 4.0 (Wikimedia Commons)",
      },
    ],
    tiers: standardTiers("aya-nakamura-montreal"),
    sources: [
      { label: "Aya Nakamura on Instagram", url: "https://www.instagram.com/ayanakamura_officiel/" },
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

/** Total number of campaign visuals the fixtures produce (hero + card + gallery). */
export function expectedVisualCount(): number {
  return SHOW_CAMPAIGN_FIXTURES.reduce((total, fixture) => total + 2 + fixture.gallery.length, 0);
}

/** Total number of campaign tiers the fixtures produce. */
export function expectedTierCount(): number {
  return SHOW_CAMPAIGN_FIXTURES.reduce((total, fixture) => total + fixture.tiers.length, 0);
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
    if (fixture.gallery.length === 0) throw new Error(`No gallery images: ${fixture.artist.displayName}`);

    const galleryKeys = new Set<string>();
    for (const asset of fixture.gallery) {
      if (galleryKeys.has(asset.key)) throw new Error(`Duplicate gallery key ${asset.key} on ${fixture.campaign.slug}`);
      galleryKeys.add(asset.key);
    }
    if (fixture.artist.portraitKey && !galleryKeys.has(fixture.artist.portraitKey)) {
      throw new Error(`portraitKey ${fixture.artist.portraitKey} not present in gallery for ${fixture.campaign.slug}`);
    }

    const assetNames = [fixture.campaign.heroAsset, ...fixture.gallery.map((asset) => asset.file)];
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

    const visualUrl = (key: string) => `/shows/campaigns/${fixture.campaign.id}/visuals/sample-${fixture.campaign.slug}-${key}`;

    const hero = await uploadAsset(fixture.campaign.heroAsset);
    const gallery: Array<{ asset: ShowGalleryAsset; stored: { mimeType: string; storageUri: string } }> = [];
    for (const asset of fixture.gallery) {
      const stored = await uploadAsset(asset.file);
      gallery.push({ asset, stored });
    }

    const heroUrl = `/shows/campaigns/${fixture.campaign.id}/visuals/hero`;
    const cardUrl = `/shows/campaigns/${fixture.campaign.id}/visuals/card`;
    const heroCredit = fixture.campaign.heroCredit ?? "AI-generated campaign concept artwork; not an artist photograph";
    const artistImageUrl = fixture.artist.portraitKey ? visualUrl(fixture.artist.portraitKey) : heroUrl;

    const campaignData = {
      slug: fixture.campaign.slug,
      artistId: fixture.artist.id,
      artistDisplayName: fixture.artist.displayName,
      artistImageUrl,
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
      status: "active" as const,
      campaignLevel: "active_escrow_campaign" as const,
      artistAuthorityStatus: "none" as const,
      metadata: {
        fixture: true,
        fixtureSet: "sample-show-campaigns/v1",
        fictionalCampaign: true,
        artistEndorsed: false,
        venueConfirmed: false,
        sources: fixture.sources,
      },
    };

    await prisma.artist.upsert({
      where: { id: fixture.artist.id },
      update: {
        displayName: fixture.artist.displayName,
        imageUrl: artistImageUrl,
        summary: fixture.artist.summary,
        socialLinks: fixture.artist.socialLinks,
        profileType: "fixture",
        claimStatus: "unclaimed",
      },
      create: {
        id: fixture.artist.id,
        displayName: fixture.artist.displayName,
        imageUrl: artistImageUrl,
        summary: fixture.artist.summary,
        socialLinks: fixture.artist.socialLinks,
        profileType: "fixture",
        claimStatus: "unclaimed",
      },
    });

    await prisma.showCampaign.upsert({
      where: { id: fixture.campaign.id },
      update: campaignData,
      create: { id: fixture.campaign.id, ...campaignData },
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
          caption: `${fixture.campaign.title} — sample campaign hero.`,
          credit: heroCredit,
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
          credit: heroCredit,
        },
        ...gallery.map(({ asset, stored }, index) => ({
          id: `sample-${fixture.campaign.slug}-${asset.key}`,
          campaignId: fixture.campaign.id,
          role: "gallery",
          publicUrl: visualUrl(asset.key),
          storageUri: stored.storageUri,
          mimeType: stored.mimeType,
          sortOrder: 10 + index,
          caption: asset.caption,
          credit: asset.credit,
        })),
      ],
    });
  }

  return { campaigns: SHOW_CAMPAIGN_FIXTURES.length, dryRun: false };
}
