import Link from "next/link";
import type { PublicCommunityProfileResponse } from "../../lib/api";
import { PunchlineCollectibleCard } from "../punchline/PunchlineCollectibleCard";

type OwnedMoment = NonNullable<PublicCommunityProfileResponse["showcase"]["ownedMoments"]>[number];

type ShowcaseItem = {
  key: string;
  label: string;
  status: "visible" | "hidden";
  value: string;
};

export function publicCommunityShowcaseItems(profile: PublicCommunityProfileResponse): ShowcaseItem[] {
  return [
    {
      key: "wallet",
      label: "Wallet",
      status: profile.showcase.walletAddress ? "visible" : "hidden",
      value: profile.showcase.walletAddress ?? "Hidden by listener",
    },
    {
      key: "owned-items",
      label: "Owned items",
      status: profile.showcase.ownedItemsVisible ? "visible" : "hidden",
      value: profile.showcase.ownedItemsVisible
        ? ownedMomentsSummary(profile.showcase.ownedMoments?.length ?? 0)
        : "Hidden by listener",
    },
    {
      key: "taste-badges",
      label: "Taste badges",
      status: profile.showcase.tasteBadgesVisible ? "visible" : "hidden",
      value: profile.showcase.tasteBadgesVisible ? "Ready for future badge cards" : "Hidden by listener",
    },
    {
      key: "playlists",
      label: "Playlists",
      status: profile.showcase.playlistsVisible ? "visible" : "hidden",
      value: profile.showcase.playlistsVisible ? "Ready for future playlist cards" : "Hidden by listener",
    },
    {
      key: "campaign-support",
      label: "Campaign support",
      status: profile.showcase.campaignSupportVisible ? "visible" : "hidden",
      value: profile.showcase.campaignSupportVisible
        ? campaignSupportSummary(profile.showcase.campaignSupport.length)
        : "Hidden by listener",
    },
    {
      key: "show-attendance",
      label: "Show attendance",
      status: profile.showcase.showAttendanceVisible ? "visible" : "hidden",
      value: profile.showcase.showAttendanceVisible ? "Ready for future attendance proofs" : "Hidden by listener",
    },
  ];
}

export function PublicCommunityProfile({
  profile,
  requestedUserId,
}: {
  profile: PublicCommunityProfileResponse | null;
  requestedUserId: string;
}) {
  if (!profile) {
    return (
      <main className="community-profile-page">
        <section className="community-profile-hero community-profile-hero--hidden">
          <span className="community-profile-kicker">Community profile</span>
          <h1>Profile unavailable</h1>
          <p>This listener has not made a public community profile visible.</p>
          <Link href="/" className="community-profile-link">Back to Resonate</Link>
        </section>
      </main>
    );
  }

  const items = publicCommunityShowcaseItems(profile);
  const visibleCount = items.filter((item) => item.status === "visible").length;
  const initial = profile.profile.displayName.trim().charAt(0).toUpperCase() || "R";

  return (
    <main className="community-profile-page">
      <section className="community-profile-hero">
        <div className="community-profile-avatar" aria-hidden>
          {profile.profile.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- User-provided remote avatars are not configured for Next image domains yet.
            <img src={profile.profile.avatarUrl} alt="" />
          ) : (
            <span>{initial}</span>
          )}
        </div>
        <div className="community-profile-identity">
          <span className="community-profile-kicker">Listener profile</span>
          <h1>{profile.profile.displayName}</h1>
          <p>{profile.profile.bio || "No public bio yet."}</p>
          <div className="community-profile-meta">
            <span>Public</span>
            <span>{visibleCount} visible section{visibleCount === 1 ? "" : "s"}</span>
            <span>{requestedUserId}</span>
          </div>
        </div>
      </section>

      <section className="community-profile-grid" aria-label="Community showcase">
        {items.map((item) => (
          <article
            key={item.key}
            className={`community-profile-card community-profile-card--${item.status}`}
          >
            <span className="community-profile-card__label">{item.label}</span>
            <strong>{item.status === "visible" ? "Visible" : "Private"}</strong>
            <p>{item.value}</p>
          </article>
        ))}
      </section>

      {profile.showcase.ownedMoments && profile.showcase.ownedMoments.length > 0 ? (
        <section className="community-profile-support" aria-label="Owned moments showcase">
          <span className="community-profile-kicker">Moments showcase</span>
          <div className="punchline-collect-grid">
            {profile.showcase.ownedMoments.map((owned) => (
              <div key={owned.collectibleId} className="punchline-collect-item">
                <PunchlineCollectibleCard
                  title={owned.moment.title}
                  lyricText={owned.moment.lyricText}
                  artworkUrl={owned.moment.artworkUrl}
                  durationMs={Math.max(0, owned.moment.endMs - owned.moment.startMs)}
                  editionSize={owned.editionSize}
                  priceCents={owned.moment.priceCents}
                  rightsLabel={owned.moment.rightsLabel}
                  collectedCount={owned.moment.collectedCount}
                />
                <div className="punchline-collect-item-footer">
                  <div className="punchline-inventory-meta">
                    <span className="punchline-inventory-edition">
                      Edition #{owned.editionNumber} of {owned.editionSize}
                    </span>
                    {ownedMomentArtist(owned) ? (
                      <span className="punchline-inventory-acquired">{ownedMomentArtist(owned)}</span>
                    ) : null}
                    {formatAcquiredDate(owned.acquiredAt) ? (
                      <span className="punchline-inventory-acquired">
                        {formatAcquiredDate(owned.acquiredAt)}
                      </span>
                    ) : null}
                    {owned.drop.releaseId ? (
                      <Link
                        href={`/release/${owned.drop.releaseId}?focus=moments`}
                        className="punchline-inventory-release-link"
                      >
                        View release
                      </Link>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {profile.showcase.campaignSupportVisible && profile.showcase.campaignSupport.length > 0 ? (
        <section className="community-profile-support" aria-label="Campaign support badges">
          <span className="community-profile-kicker">Campaign support</span>
          <div className="community-profile-support__grid">
            {profile.showcase.campaignSupport.map((support) => (
              <article key={support.campaignId} className="community-profile-support-card">
                <span>{support.city}, {support.country}</span>
                <strong>{support.campaignTitle}</strong>
                <p>{support.artistDisplayName}</p>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}

function campaignSupportSummary(count: number) {
  if (count === 0) return "No public campaign support badges yet";
  return `${count} public campaign supporter badge${count === 1 ? "" : "s"}`;
}

function ownedMomentsSummary(count: number) {
  // Empty-but-visible keeps the original placeholder wording so the seam still
  // reads as "on, nothing to show yet" rather than implying zero is a state.
  if (count === 0) return "Ready for future showcase cards";
  return `${count} owned moment${count === 1 ? "" : "s"} on show`;
}

function ownedMomentArtist(owned: OwnedMoment): string | null {
  const name = owned.drop.artistName?.trim();
  if (!name) return null;
  const track = owned.drop.trackTitle?.trim();
  return track ? `${name} — ${track}` : name;
}

// Deterministic, locale-independent acquired date for the public showcase so the
// server-rendered markup is stable across environments (UTC, en-US).
function formatAcquiredDate(acquiredAt: string | null): string | null {
  if (!acquiredAt) return null;
  const date = new Date(acquiredAt);
  if (Number.isNaN(date.getTime())) return null;
  return `Collected ${new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date)}`;
}
