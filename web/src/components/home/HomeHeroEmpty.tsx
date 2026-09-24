import Link from "next/link";

/**
 * Home hero states that exist alongside the (approved, frozen) featured
 * campaign hero in `app/page.tsx` (#1869):
 *
 * - `HomeHeroSkeleton` — campaigns not loaded yet. Same `.ng-hero` frame, no
 *   text claims, no rail, no CTAs, so the real hero swaps in without layout
 *   shift and nothing invented is ever shown.
 * - `HomeHeroEmpty` — campaigns loaded and none is open for pledges. An honest
 *   invitation to start one instead of sample campaigns dressed up as real.
 *
 * `HomeHeroMotif` is the purely decorative concentric motif shared with the
 * campaign hero.
 */

export function HomeHeroMotif() {
  return (
    <svg
      className="ng-hero__motif"
      viewBox="0 0 600 600"
      aria-hidden
      focusable="false"
    >
      <g fill="none" stroke="currentColor" strokeWidth="1">
        <circle cx="300" cy="300" r="60" opacity="0.55" />
        <circle cx="300" cy="300" r="120" opacity="0.40" />
        <circle cx="300" cy="300" r="190" opacity="0.26" />
        <circle cx="300" cy="300" r="270" opacity="0.16" />
        <circle cx="300" cy="300" r="360" opacity="0.08" />
      </g>
      <circle
        className="ng-hero__motif-ping"
        cx="300"
        cy="300"
        r="60"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <circle cx="300" cy="300" r="6" fill="currentColor" opacity="0.9" />
    </svg>
  );
}

export function HomeHeroSkeleton() {
  return (
    <div
      className="ng-hero ng-hero--loading"
      aria-busy="true"
      aria-label="Loading featured campaigns"
      role="status"
    >
      <HomeHeroMotif />
      <div className="ng-hero__card ng-hero__card--skeleton" aria-hidden>
        <span className="ng-hero-skeleton__line ng-hero-skeleton__line--kicker" />
        <span className="ng-hero-skeleton__line ng-hero-skeleton__line--title" />
        <span className="ng-hero-skeleton__line ng-hero-skeleton__line--title-short" />
        <span className="ng-hero-skeleton__line ng-hero-skeleton__line--body" />
        <span className="ng-hero-skeleton__line ng-hero-skeleton__line--body-short" />
        <span className="ng-hero-skeleton__actions">
          <span className="ng-hero-skeleton__pill" />
          <span className="ng-hero-skeleton__pill ng-hero-skeleton__pill--secondary" />
        </span>
      </div>
    </div>
  );
}

export function HomeHeroEmpty() {
  return (
    <div className="ng-hero ng-hero--empty">
      <HomeHeroMotif />
      <div className="ng-hero__card">
        <span className="ng-kicker ng-kicker--primary">Resonate Shows</span>
        <h2 className="ng-hero__title">Fans bring the show.</h2>
        <p className="ng-hero__body">
          No campaigns are open for pledges right now. Fans can propose a
          show for an artist in their city — pledges are held in escrow and
          refunded automatically if the show doesn&apos;t happen.
        </p>
        <div className="ng-hero__actions">
          <Link href="/shows/create" className="ng-btn ng-btn--primary">
            <span className="ms-icon" data-fill="1" aria-hidden>rocket_launch</span>
            Start a campaign
          </Link>
          <Link href="/shows" className="ng-btn ng-btn--glass">
            Browse shows
          </Link>
        </div>
      </div>
    </div>
  );
}
