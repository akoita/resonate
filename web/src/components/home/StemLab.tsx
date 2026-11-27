import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import type { AiDisclosure, Release } from "../../lib/api";
import { getArtistName } from "../../lib/catalogDisplay";
import { AiDisclosureBadge } from "../content/AiDisclosureBadge";
import { HomeShelf } from "./HomeShelf";

/*
 * Home v3 Stem Lab — real stems only.
 *
 * Each card is a release track that actually has at least two mixer-channel
 * stems. Every channel links to the release mixer with that channel soloed
 * (`/release/{id}?mixer=true&stem={type}`), which is exactly what the release
 * page supports. Nothing here is invented: no cosmetic stem tags, no fake
 * "trending" claim — the section renders nothing when no release qualifies.
 */

/** The mixer channels the release page supports, in channel-strip order. */
export const MIXER_STEM_ORDER = ["vocals", "drums", "bass", "piano", "guitar", "other"] as const;
type MixerStemType = (typeof MIXER_STEM_ORDER)[number];

export type StemLabEntry = {
  releaseId: string;
  trackId: string;
  title: string;
  artist: string;
  artwork: ReactNode;
  aiDisclosure?: AiDisclosure | null;
  stems: { id: string; type: string }[];
};

const STEM_ACCENTS: Record<MixerStemType, string> = {
  vocals: "#C4B5FD",
  drums: "#FF8F6B",
  bass: "#7C5CFF",
  piano: "#E2DCFF",
  guitar: "#FFB782",
  other: "#9880FF",
};

function isMixerStemType(type: string): type is MixerStemType {
  return (MIXER_STEM_ORDER as readonly string[]).includes(type);
}

export function selectStemLabEntries(
  releases: Release[],
  limit = 3,
  renderArt: (release: Release) => ReactNode,
): StemLabEntry[] {
  const entries: StemLabEntry[] = [];
  for (const release of releases) {
    if (entries.length >= limit) break;
    for (const track of release.tracks ?? []) {
      const seen = new Set<string>();
      const stems: { id: string; type: string }[] = [];
      for (const stem of track.stems ?? []) {
        const type = stem.type?.trim().toLowerCase() ?? "";
        if (!isMixerStemType(type) || seen.has(type)) continue;
        seen.add(type);
        stems.push({ id: stem.id, type });
      }
      if (stems.length < 2) continue;
      stems.sort(
        (a, b) =>
          MIXER_STEM_ORDER.indexOf(a.type as MixerStemType)
          - MIXER_STEM_ORDER.indexOf(b.type as MixerStemType),
      );
      entries.push({
        releaseId: release.id,
        trackId: track.id,
        title: release.title,
        artist: getArtistName(release),
        artwork: renderArt(release),
        // The card represents the release (title, mixer), so it carries the
        // release-level disclosure summary, as the previous stem cards did.
        aiDisclosure: release.aiDisclosure ?? track.aiDisclosure,
        stems,
      });
      break; // first qualifying track per release
    }
  }
  return entries;
}

function stemLabel(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function StemLabCard({ entry }: { entry: StemLabEntry }) {
  const mixerHref = `/release/${entry.releaseId}?mixer=true`;
  return (
    <article className="ng-stemlab-card">
      <div className="ng-stemlab-card__top">
        <Link
          href={mixerHref}
          className="ng-stemlab-card__art"
          aria-label={`Open ${entry.title} in the mixer`}
        >
          {entry.artwork}
        </Link>
        <div className="ng-stemlab-card__info">
          <h4 className="ng-stemlab-card__title">{entry.title}</h4>
          <p className="ng-stemlab-card__artist">{entry.artist}</p>
          <AiDisclosureBadge disclosure={entry.aiDisclosure} />
        </div>
      </div>
      <div className="ng-stemlab-card__channels">
        {entry.stems.map((stem) => {
          const label = stemLabel(stem.type);
          const accent = STEM_ACCENTS[stem.type as MixerStemType] ?? STEM_ACCENTS.other;
          return (
            <Link
              key={stem.id}
              href={`${mixerHref}&stem=${stem.type}`}
              className="ng-stemlab-channel"
              data-stem={stem.type}
              aria-label={`Solo ${label} of ${entry.title} in the mixer`}
              style={{ "--stem-accent": accent } as CSSProperties}
            >
              {/* A channel fader, not a level meter: the catalog carries no
                  per-stem level data, so nothing here pretends to measure the
                  audio. Hover or focus raises the fader, as soloing would. */}
              <span className="ng-stemlab-channel__fader" aria-hidden>
                <span className="ng-stemlab-channel__fill" />
                <span className="ng-stemlab-channel__knob" />
              </span>
              <span className="ng-stemlab-channel__label">{label}</span>
            </Link>
          );
        })}
      </div>
      <footer className="ng-stemlab-card__footer">
        <span>
          {entry.stems.length} stem{entry.stems.length === 1 ? "" : "s"}
        </span>
        <Link href={mixerHref} className="ng-stemlab-card__open">
          Open mixer
          <span className="ms-icon" aria-hidden>arrow_forward</span>
        </Link>
      </footer>
    </article>
  );
}

export function StemLab({ entries }: { entries: StemLabEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <HomeShelf
      kicker="Pull a song apart"
      kickerTone="tertiary"
      title="Stem Lab"
      description="Solo any layer of a real release in the mixer — vocals, drums, bass and more."
      itemWidth={320}
      className="ng-shelf--fill"
      action={{ href: "/catalog", label: "Browse catalog" }}
      testId="stem-lab"
    >
      {entries.map((entry) => (
        <StemLabCard key={`${entry.releaseId}-${entry.trackId}`} entry={entry} />
      ))}
    </HomeShelf>
  );
}
