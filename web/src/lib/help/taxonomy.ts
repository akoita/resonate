import type { HelpAudience, HelpCategoryId, HelpStatus } from "./types";

export interface AudienceMeta {
  id: HelpAudience;
  label: string;
  /** Short blurb shown on the persona chips. */
  blurb: string;
}

/** Ordered for the persona filter. "everyone" first. */
export const AUDIENCES: AudienceMeta[] = [
  { id: "everyone", label: "Everyone", blurb: "Accounts, wallet, settings, and the basics." },
  { id: "listener", label: "Listeners", blurb: "Discover, play, collect, and back the music you love." },
  { id: "artist", label: "Artists", blurb: "Upload, protect, sell, and grow your catalog." },
  { id: "producer", label: "Producers & remixers", blurb: "License stems and build something new." },
  { id: "curator", label: "Curators & reporters", blurb: "Help keep the catalog honest." },
  { id: "operator", label: "Operators & admins", blurb: "Run trust, disputes, and campaigns." },
];

export interface CategoryMeta {
  id: HelpCategoryId;
  label: string;
  blurb: string;
}

/** Ordered for the landing page (top to bottom). */
export const CATEGORIES: CategoryMeta[] = [
  { id: "get-started", label: "Get started", blurb: "Create an account and find your way around." },
  { id: "discover", label: "Discover & listen", blurb: "Browse, play, and let the AI DJ guide you." },
  { id: "library", label: "Your library & playlists", blurb: "Save tracks and share what you love." },
  { id: "marketplace", label: "Collect & sell stems", blurb: "Own licensed audio and list your own." },
  { id: "create", label: "Create & remix", blurb: "Generate and remix music with AI." },
  { id: "artists", label: "For artists", blurb: "Upload, protect, and understand your audience." },
  { id: "shows", label: "Resonate Shows", blurb: "Turn fan demand into real concerts." },
  { id: "community", label: "Community", blurb: "Cohorts, artist rooms, and holder benefits." },
  { id: "trust", label: "Trust & safety", blurb: "Rights, reporting, and disputes." },
  { id: "account", label: "Account, wallet & privacy", blurb: "Settings, security, and troubleshooting." },
];

const AUDIENCE_LABELS = new Map(AUDIENCES.map((a) => [a.id, a.label]));
const CATEGORY_META = new Map(CATEGORIES.map((c) => [c.id, c]));

export function audienceLabel(id: HelpAudience): string {
  return AUDIENCE_LABELS.get(id) ?? id;
}

export function categoryMeta(id: HelpCategoryId): CategoryMeta | undefined {
  return CATEGORY_META.get(id);
}

export const STATUS_LABELS: Record<HelpStatus, string> = {
  available: "Available now",
  partial: "Partly available",
  "coming-soon": "Coming soon",
};
