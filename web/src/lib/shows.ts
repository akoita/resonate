/**
 * Resonate Shows — fan-funded artist-booking campaigns.
 *
 * This module defines the client-side shape of a campaign plus three
 * seeded mocks used by the home page and the `/shows` routes. The async
 * stubs (`listCampaigns`, `getCampaign`) are the API seam the Week-1
 * backend module (`backend/src/modules/shows/`) will replace by hitting
 * `/api/campaigns` and `/api/campaigns/:id`. Keep the signatures stable
 * so the UI doesn't change when the real backend lands.
 */

export type CampaignStatus = "active" | "funded" | "refunded" | "booked";

export interface Campaign {
  id: string;
  artistName: string;
  artistSlug: string;
  city: string;
  venue?: string;
  targetDate: string;     // ISO — when the show would happen
  deadline: string;       // ISO — funding deadline (drives countdown)
  goalCents: number;
  raisedCents: number;
  currency: "EUR" | "USD";
  backerCount: number;
  thresholdBackers: number;
  heroImage: string;      // optional; empty string → gradient placeholder
  cardImage: string;
  status: CampaignStatus;
  featured: boolean;
  // Sepolia escrow contract. Until Campaign.sol ships, we link to the
  // already-deployed RevenueEscrow.sol as an honest stand-in so the
  // "Trust the code" link leads to a real contract, not a fake address.
  contractAddress: string;
  etherscanUrl: string;
  // Short pitch shown on the hero + detail page.
  tagline: string;
}

const SEPOLIA_REVENUE_ESCROW = "0x411e121a97b6901b2e81f67a795e8063c1b8d472";
const SEPOLIA_ETHERSCAN = `https://sepolia.etherscan.io/address/${SEPOLIA_REVENUE_ESCROW}`;

const addDays = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
};

const CAMPAIGNS: Campaign[] = [
  {
    id: "sennarin-paris",
    artistName: "Sennarin",
    artistSlug: "sennarin",
    city: "Paris",
    venue: "Le Trianon",
    targetDate: addDays(180),
    deadline: addDays(14),
    goalCents: 10_000_000,
    raisedCents: 6_720_000,
    currency: "EUR",
    backerCount: 127,
    thresholdBackers: 500,
    heroImage: "",
    cardImage: "",
    status: "active",
    featured: true,
    contractAddress: SEPOLIA_REVENUE_ESCROW,
    etherscanUrl: SEPOLIA_ETHERSCAN,
    tagline: "Bring Sennarin to Paris for her first European headline show.",
  },
  {
    id: "luka-tokyo",
    artistName: "LUKA",
    artistSlug: "luka",
    city: "Tokyo",
    targetDate: addDays(210),
    deadline: addDays(28),
    goalCents: 8_000_000,
    raisedCents: 2_480_000,
    currency: "EUR",
    backerCount: 89,
    thresholdBackers: 400,
    heroImage: "",
    cardImage: "",
    status: "active",
    featured: false,
    contractAddress: SEPOLIA_REVENUE_ESCROW,
    etherscanUrl: SEPOLIA_ETHERSCAN,
    tagline: "The Tokyo fanbase has been asking for a hometown show since 2023.",
  },
  {
    id: "meridian-lagos",
    artistName: "Meridian",
    artistSlug: "meridian",
    city: "Lagos",
    targetDate: addDays(240),
    deadline: addDays(45),
    goalCents: 6_000_000,
    raisedCents: 480_000,
    currency: "EUR",
    backerCount: 42,
    thresholdBackers: 300,
    heroImage: "",
    cardImage: "",
    status: "active",
    featured: false,
    contractAddress: SEPOLIA_REVENUE_ESCROW,
    etherscanUrl: SEPOLIA_ETHERSCAN,
    tagline: "Afrobeats in its capital — the campaign just opened.",
  },
];

export async function listCampaigns(): Promise<Campaign[]> {
  return CAMPAIGNS;
}

export async function getCampaign(id: string): Promise<Campaign | null> {
  return CAMPAIGNS.find((c) => c.id === id) ?? null;
}

// Re-exported as a sync getter for synchronous render paths (e.g. initial
// Sennarin hero render before client-side fetch resolves). Keep the async
// API above as the canonical one — delete this when a real API hooks in.
export function listCampaignsSync(): Campaign[] {
  return CAMPAIGNS;
}

export function getCampaignSync(id: string): Campaign | null {
  return CAMPAIGNS.find((c) => c.id === id) ?? null;
}

export function getFeaturedCampaignSync(): Campaign {
  return CAMPAIGNS.find((c) => c.featured) ?? CAMPAIGNS[0];
}

/**
 * Format a cents amount like 6_720_000 → "€67,200" (no fractional part
 * for the progress readout; the pledge flow will render cents later).
 */
export function formatMoney(cents: number, currency: Campaign["currency"]): string {
  const amount = Math.floor(cents / 100);
  const symbol = currency === "EUR" ? "€" : "$";
  return `${symbol}${amount.toLocaleString("en-US")}`;
}

/**
 * Format a cents amount compact: 6_720_000 → "€67.2k".
 */
export function formatMoneyCompact(cents: number, currency: Campaign["currency"]): string {
  const amount = cents / 100;
  const symbol = currency === "EUR" ? "€" : "$";
  if (amount >= 1000) {
    const k = amount / 1000;
    // 67.2 → "67.2", 80 → "80"
    const display = k >= 100 || k % 1 === 0 ? k.toFixed(0) : k.toFixed(1);
    return `${symbol}${display}k`;
  }
  return `${symbol}${amount.toLocaleString("en-US")}`;
}

/**
 * Clamp a 0-1 progress ratio from raised/goal.
 */
export function progressRatio(c: Campaign): number {
  if (c.goalCents <= 0) return 0;
  return Math.max(0, Math.min(1, c.raisedCents / c.goalCents));
}

/**
 * Integer days between now and the deadline, clamped to 0.
 */
export function daysUntil(deadlineIso: string, now: number = Date.now()): number {
  const diff = new Date(deadlineIso).getTime() - now;
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}
