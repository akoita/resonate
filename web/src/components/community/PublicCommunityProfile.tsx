import Link from "next/link";
import type { PublicCommunityProfileResponse } from "../../lib/api";

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
      value: profile.showcase.ownedItemsVisible ? "Ready for future showcase cards" : "Hidden by listener",
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
      value: profile.showcase.campaignSupportVisible ? "Ready for future campaign proofs" : "Hidden by listener",
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
    </main>
  );
}
