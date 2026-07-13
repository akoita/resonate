import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  editionsRemaining,
  fetchPublicCollectible,
  fetchPublicMoment,
  momentShareDescription,
  momentShareTitle,
  type PublicCollectibleShare,
  type PublicMomentShare,
} from "../../../lib/momentShare";
import { MomentPermalinkCard } from "../../../components/punchline/MomentPermalinkCard";
import { formatPriceCents } from "../../../components/punchline/punchlineDropHelpers";
import { resolveClipUrl } from "../../../components/punchline/punchlineCollectHelpers";

/**
 * Public moment permalink (#1477 slice 2). Server-rendered so social crawlers
 * get rich metadata + an OG card (see `opengraph-image.tsx`). `?c=<collectibleId>`
 * upgrades the page to the edition-pride view when the collector opted in;
 * otherwise it silently falls back to the plain moment view.
 */

interface Props {
  params: Promise<{ momentId: string }>;
  searchParams: Promise<{ c?: string }>;
}

type LoadedShare = {
  share: PublicMomentShare | null;
  edition: PublicCollectibleShare["edition"] | null;
};

async function loadShare(momentId: string, collectibleId?: string): Promise<LoadedShare> {
  if (collectibleId) {
    const collectible = await fetchPublicCollectible(collectibleId);
    // Guard against a mismatched `?c` (collectible of a different moment).
    if (collectible && collectible.moment.id === momentId) {
      return { share: collectible, edition: collectible.edition };
    }
  }
  const share = await fetchPublicMoment(momentId);
  return { share, edition: null };
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { momentId } = await params;
  const { c } = await searchParams;
  const { share, edition } = await loadShare(momentId, c);
  if (!share) {
    return { title: "Moment" };
  }
  const title = momentShareTitle(share);
  const description = momentShareDescription(share, edition);
  // The file-based `opengraph-image` route auto-supplies og:image + twitter:image.
  return {
    title,
    description,
    openGraph: { title, description, type: "article" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function MomentPermalinkPage({ params, searchParams }: Props) {
  const { momentId } = await params;
  const { c } = await searchParams;
  const { share, edition } = await loadShare(momentId, c);
  if (!share) {
    notFound();
  }

  const left = editionsRemaining(share.moment);
  const clipUrl = resolveClipUrl(share.moment.clipAssetUri);
  const footer = [share.artistName, share.track.title].filter(Boolean).join(" · ");

  return (
    <main
      style={{
        maxWidth: 560,
        margin: "0 auto",
        padding: "32px 20px 64px",
        display: "flex",
        flexDirection: "column",
        gap: 24,
      }}
    >
      <span className="punchline-collect-eyebrow">🎤 Drops · Punchline</span>

      <MomentPermalinkCard share={share} clipUrl={clipUrl} />

      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {edition ? (
          <p style={{ fontWeight: 700, margin: 0 }}>
            № {edition.editionNumber} of {share.moment.editionSize} — collected by{" "}
            {edition.collectorDisplayName}
          </p>
        ) : null}
        {footer ? <p style={{ opacity: 0.85, margin: 0 }}>{footer}</p> : null}
        <p style={{ opacity: 0.85, margin: 0 }}>
          {left > 0
            ? `${left} of ${share.moment.editionSize} editions left`
            : "Sold out"}{" "}
          · {formatPriceCents(share.moment.priceCents)}
        </p>
        <p style={{ opacity: 0.7, fontSize: 13, margin: 0 }}>{share.moment.rightsLabel}</p>
        <Link
          href={`/release/${encodeURIComponent(share.release.id)}?focus=moments`}
          className="punchline-btn-primary"
          style={{ marginTop: 8, textAlign: "center" }}
        >
          Collect this moment
        </Link>
      </section>
    </main>
  );
}
