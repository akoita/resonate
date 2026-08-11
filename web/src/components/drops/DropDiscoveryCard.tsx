import Link from "next/link";
import type {
  FeaturedDrop,
  PunchlineMoment,
  DropsBrowsePrice,
} from "../../lib/api";
import { PunchlineCollectibleCard } from "../punchline/PunchlineCollectibleCard";
import { DROP_KIND_LABEL } from "../punchline/punchlineDropHelpers";

type DiscoveryDrop = FeaturedDrop & {
  availability?: { soldOut: boolean };
};

function matchesPrice(moment: PunchlineMoment, price: DropsBrowsePrice) {
  if (price === "free") return moment.priceCents <= 0;
  if (price === "paid") return moment.priceCents > 0;
  return true;
}

/** Selects the first available face, constrained to a price class when possible. */
export function discoveryMoment(
  drop: DiscoveryDrop,
  price: DropsBrowsePrice = "all",
): PunchlineMoment | null {
  const matching = drop.moments.filter((moment) => matchesPrice(moment, price));
  const candidates = matching.length > 0 ? matching : drop.moments;
  return (
    candidates.find((moment) => moment.collectedCount < moment.editionSize) ??
    candidates[0] ??
    null
  );
}

export function DropDiscoveryCard({
  drop,
  price = "all",
  testId = "drop-discovery-card",
}: {
  drop: DiscoveryDrop;
  price?: DropsBrowsePrice;
  testId?: string;
}) {
  const moment = discoveryMoment(drop, price);
  if (!moment) return null;
  const momentSoldOut = moment.collectedCount >= moment.editionSize;

  return (
    <Link
      href={`/release/${drop.context.releaseId}?focus=moments`}
      className="ng-glass ng-drops-card"
      style={{
        display: "block",
        borderRadius: 20,
        padding: 14,
        textDecoration: "none",
        color: "inherit",
        position: "relative",
      }}
      data-testid={testId}
      aria-label={`${momentSoldOut ? "View sold-out" : "Collect"} ${moment.title} from ${drop.context.trackTitle}`}
    >
      {drop.availability?.soldOut && (
        <span className="drops-card-sold-out">Sold out</span>
      )}
      <PunchlineCollectibleCard
        title={moment.title}
        lyricText={moment.lyricText}
        artworkUrl={moment.artworkUrl}
        durationMs={moment.endMs - moment.startMs}
        editionSize={moment.editionSize}
        priceCents={moment.priceCents}
        rightsLabel={moment.rightsLabel}
        collectedCount={moment.collectedCount}
        imageLoading="lazy"
        imageDecoding="async"
      />
      <p
        className="ng-play-card__artist ng-drops-card__context"
        style={{
          marginTop: 10,
          display: "flex",
          flexWrap: "wrap",
          gap: "4px 8px",
          alignItems: "baseline",
        }}
      >
        <span className="punchline-kind-chip">{DROP_KIND_LABEL}</span>
        <strong className="ng-drops-card__artist" style={{ fontWeight: 700 }}>
          {drop.context.artistName ?? "Unknown artist"}
        </strong>
        <span className="ng-drops-card__track" style={{ opacity: 0.7 }}>
          · {drop.context.trackTitle}
        </span>
      </p>
    </Link>
  );
}
