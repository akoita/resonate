"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "../auth/AuthProvider";
import { useUIStore } from "../../lib/uiStore";
import { getArtistMe, type ArtistProfile } from "../../lib/api";
import { getEnvironment, isProduction } from "../../lib/buildInfo";
import { AboutModal } from "../ui/AboutModal";
import { ContextMenu, type ContextMenuItem } from "../ui/ContextMenu";
import { AUTH_COPY } from "../../lib/authCopy";
import { BrandLogo } from "../brand/BrandLogo";
import { useProductSurfaces } from "../../hooks/useProductSurfaces";
import { useHasDiscoveries } from "../../hooks/useHasDiscoveries";
import { useAccountName } from "../../hooks/useAccountName";
import { SidebarFoldButton, SidebarResizeEdge, useRailTooltips, useSidebarLayout } from "./SidebarEdge";
import type { ProductSurface } from "../../lib/productSurfaces";

const subscribe = () => () => {};

const PRIMARY_ITEMS = [
  {
    name: "Home",
    href: "/",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    )
  },
  {
    name: "Player",
    href: "/player",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="7" width="20" height="15" rx="2" ry="2" /><polyline points="17 2 12 7 7 2" />
      </svg>
    )
  },
  {
    name: "Library",
    href: "/library",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
    )
  },
  {
    // Shown only once the listener's Sonic Radar has discoveries (see sidebarDestinations).
    name: "Sonic Radar",
    href: "/sonic-radar",
    surface: "sonicRadar" as ProductSurface,
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="2" />
        <path d="M16.24 7.76a6 6 0 0 1 0 8.49" />
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
        <path d="M7.76 16.24a6 6 0 0 1 0-8.49" />
        <path d="M4.93 19.07a10 10 0 0 1 0-14.14" />
      </svg>
    )
  },
  {
    name: "Shows",
    href: "/shows",
    badge: "NEW" as const,
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 10h18" /><path d="M7 10V4" /><path d="M17 10V4" /><rect x="3" y="4" width="18" height="16" rx="2" />
      </svg>
    )
  },
  {
    name: "Drops",
    href: "/drops",
    badge: "NEW" as const,
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3 4 7v10l8 4 8-4V7l-8-4Z" /><path d="m4 7 8 4 8-4" /><path d="M12 11v10" />
      </svg>
    )
  },
  {
    name: "Crates & Stems",
    href: "/crates",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 8v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8" /><path d="M23 3H1v5h22z" /><path d="M10 12h4" />
      </svg>
    )
  },
  {
    // Owner choice (2026-11-27): Community is a listener destination while
    // its switch is on; #2663 had dropped it to reach eight items.
    name: "Community",
    href: "/community",
    surface: "community" as ProductSurface,
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    )
  },

];


/** #2663: shown to accounts with an artist profile. AI generation comes last. */
const ARTIST_ITEMS = [
  {
    name: "Upload",
    href: "/artist/upload",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
      </svg>
    )
  },
  {
    name: "Catalog",
    href: "/artist/catalog",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M7 8h10" />
        <path d="M7 12h10" />
        <path d="M7 16h6" />
      </svg>
    )
  },
  {
    name: "Listings",
    href: "/artist/listings",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" />
      </svg>
    )
  },
  {
    name: "Analytics",
    href: "/artist/analytics",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    )
  },
  {
    name: "Disputes",
    href: "/disputes",
    surface: "disputes" as ProductSurface,
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l8 4v6c0 5-3.5 7.5-8 8-4.5-.5-8-3-8-8V7l8-4Z" />
        <path d="M9 12h6" />
        <path d="M12 9v6" />
      </svg>
    )
  },
  {
    name: "Create with AI",
    href: "/create",
    surface: "aiGeneration" as ProductSurface,
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3v18" /><path d="M18.5 8.5L6 17" /><path d="M6 8.5l12.5 8.5" />
      </svg>
    )
  },
];

/** #2663: account destinations every listener sees, after the listening ones. */
const ACCOUNT_ITEMS = [
  {
    name: "Settings",
    href: "/settings",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1Z" />
      </svg>
    )
  },
  {
    name: "User Guide",
    href: "/help",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        <path d="M9 7h7" />
        <path d="M9 11h5" />
      </svg>
    )
  },
];


/**
 * The sidebar account card's menu: where "your account" lives, then Sign out.
 * Artists' profile is their public artist page; listeners edit theirs under
 * Settings > Community. Wallet shows only while the deployment offers it.
 */
export function accountMenuDestinations(input: { artistProfileId: string | null; walletOn: boolean }) {
  return [
    {
      label: "Profile",
      href: input.artistProfileId ? `/artist/${input.artistProfileId}` : "/settings?section=community",
    },
    ...(input.walletOn ? [{ label: "Wallet", href: "/wallet" }] : []),
    { label: "Settings", href: "/settings" },
  ];
}

type NavItem = { name: string; href: string; surface?: ProductSurface; icon: React.ReactNode; badge?: "NEW" };

/**
 * The destinations the sidebar offers (#2663): the listening ones and the
 * account ones for everybody, the artist group only to accounts with an
 * artist profile, and nothing whose surface is switched off. A listener sees
 * nine with Community on, ten once Sonic Radar has discoveries. Operator links
 * are added separately.
 */
export function sidebarDestinations(
  input: { isArtist: boolean; surfaces: Partial<Record<ProductSurface, boolean>>; hasDiscoveries?: boolean },
): { primary: NavItem[]; artist: NavItem[]; account: NavItem[] } {
  const offered = (item: NavItem) => !item.surface || input.surfaces[item.surface] === true;
  // Sonic Radar joins once it has something to show, so a newcomer is never
  // sent to an empty page.
  const listed = (item: NavItem) => offered(item) && (item.href !== "/sonic-radar" || input.hasDiscoveries === true);
  return {
    primary: PRIMARY_ITEMS.filter(listed),
    artist: input.isArtist ? ARTIST_ITEMS.filter(offered) : [],
    account: ACCOUNT_ITEMS.filter(offered),
  };
}

/**
 * Crates & Stems owns every /crates route (the Browse stems tab and each saved
 * crate), so it stays highlighted on /crates/<id>; other items match exactly.
 */
function isPrimaryItemActive(pathname: string, href: string): boolean {
  if (href === "/crates") return pathname === href || pathname.startsWith(`${href}/`);
  return pathname === href;
}

export default function Sidebar() {
  const pathname = usePathname();
  const sidebarRef = useRef<HTMLElement>(null);
  // Width and fold, remembered per device (wide screens only).
  const sidebarLayout = useSidebarLayout();
  useRailTooltips(sidebarRef, sidebarLayout.rail);
  const { role, status, address, smartAccountAddress, token, disconnect } = useAuth();
  const router = useRouter();
  const accountButtonRef = useRef<HTMLButtonElement>(null);
  const [accountMenuAt, setAccountMenuAt] = useState<{ x: number; y: number } | null>(null);
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  const { isSidebarOpen, closeSidebar } = useUIStore();
  const [artistProfile, setArtistProfile] = useState<ArtistProfile | null>(null);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const showEnvBadge = mounted && !isProduction();
  const envLabel = getEnvironment();
  // Product surface switches (#2658): hide entry points the deployment has
  // switched off.
  const { surfaces } = useProductSurfaces();

  // Auto-close drawer on route change only. `closeSidebar` is a Zustand
  // action — referentially stable, deliberately excluded from deps so
  // this doesn't re-run on unrelated state changes that could cancel a
  // just-opened drawer mid-interaction.
  useEffect(() => {
    closeSidebar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Artist-profile fetch: decides whether the "For artists" links show. Most
  // users aren't artists; getArtistMe returns null in that case.
  useEffect(() => {
    if (status !== "authenticated" || !token) {
      setArtistProfile(null);
      return;
    }
    let cancelled = false;
    getArtistMe(token)
      .then(p => { if (!cancelled) setArtistProfile(p); })
      .catch(() => { if (!cancelled) setArtistProfile(null); });
    return () => { cancelled = true; };
  }, [status, token]);

  const showAdminLink = mounted && role === "admin";
  const isArtist = mounted && status === "authenticated" && artistProfile !== null;
  const hasDiscoveries = useHasDiscoveries(mounted && surfaces.sonicRadar);
  const destinations = sidebarDestinations({ isArtist, surfaces, hasDiscoveries });
  const showManagementRecoveryLink = mounted && (role === "admin" || role === "operator");
  const showUserChip = mounted && status === "authenticated" && !!(smartAccountAddress ?? address);

  // Name the person, never the address behind their passkey account.
  const accountName = useAccountName(token, showUserChip);
  const primaryLabel = accountName ?? "Your account";
  const userInitial = accountName ? accountName[0]!.toUpperCase() : "";
  const accountMenuItems = accountMenuDestinations({
    artistProfileId: artistProfile?.id ?? null,
    walletOn: surfaces.wallet,
  }).map<ContextMenuItem>((item) => ({
    label: item.label,
    onClick: () => router.push(item.href),
  })).concat({ label: "", separator: true, onClick: () => {} }, {
    label: AUTH_COPY.signOut,
    onClick: () => {
      disconnect();
      router.push("/");
    },
  });

  const renderLink = (item: NavItem) => {
    const isActive = pathname === item.href;
    return (
      <Link
        key={item.href}
        href={item.href}
        prefetch={false}
        className={`sidebar-link ${isActive ? 'active' : ''}`}
        aria-current={isActive ? "page" : undefined}
      >
        <span className="link-icon">{item.icon}</span>
        <span className="link-text">{item.name}</span>
      </Link>
    );
  };

  return (
    <>
      {isSidebarOpen ? (
        <div
          className="sidebar-backdrop"
          onClick={closeSidebar}
          aria-hidden="true"
        />
      ) : null}
      <aside
        ref={sidebarRef}
        id="primary-navigation"
        className={`app-sidebar ${isSidebarOpen ? "open" : ""}`}
        aria-label="Application navigation"
      >
      <div className="sidebar-logo">
        <BrandLogo size={34} wordmarkAs="h2" />
        {sidebarLayout.media === "wide" ? <SidebarFoldButton layout={sidebarLayout.layout} /> : null}
        {showEnvBadge ? (
          <button
            type="button"
            className="env-badge"
            onClick={() => setIsAboutOpen(true)}
            title={`${envLabel} build — click for details`}
            aria-label={`Environment: ${envLabel}. Open About dialog.`}
          >
            {envLabel}
          </button>
        ) : null}
      </div>

      <nav className="sidebar-nav primary" aria-label="Primary">
        {destinations.primary.map((item) => {
          const isActive = isPrimaryItemActive(pathname, item.href);
          const badge = item.badge;
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={false}
              className={`sidebar-link ${isActive ? 'active' : ''}`}
              aria-current={isActive ? "page" : undefined}
            >
              <span className="link-icon">{item.icon}</span>
              <span className="link-text">{item.name}</span>
              {badge ? <span className="sidebar-link__new">{badge}</span> : null}
              {isActive && <div className="active-pill" />}
            </Link>
          );
        })}

      </nav>

      {/* Spacer to push secondary nav down */}
      <div className="flex-grow" />

      <nav className="sidebar-nav secondary" aria-label="Artist and account">
        <div className="nav-divider" />
        {destinations.artist.length > 0 ? (
          <>
            <div className="sidebar-group-label">For artists</div>
            {destinations.artist.map((item) => renderLink(item))}
            <div className="nav-divider" />
          </>
        ) : null}
        {destinations.account.map((item) => renderLink(item))}
        {showAdminLink ? (
          <>
            <Link
              href="/disputes/admin"
              prefetch={false}
              className={`sidebar-link ${pathname === "/disputes/admin" ? 'active' : ''}`}
              aria-current={pathname === "/disputes/admin" ? "page" : undefined}
            >
              <span className="link-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3l7 4v5c0 5-3.5 8-7 9-3.5-1-7-4-7-9V7l7-4Z" />
                  <path d="m9 12 2 2 4-4" />
                </svg>
              </span>
              <span className="link-text">Admin Review</span>
            </Link>
            <Link
              href="/admin/community/cohorts"
              prefetch={false}
              className={`sidebar-link ${pathname === "/admin/community/cohorts" ? 'active' : ''}`}
              aria-current={pathname === "/admin/community/cohorts" ? "page" : undefined}
            >
              <span className="link-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </span>
              <span className="link-text">Cohorts</span>
            </Link>
            <Link
              href="/admin/community/moderation"
              prefetch={false}
              className={`sidebar-link ${pathname === "/admin/community/moderation" ? 'active' : ''}`}
              aria-current={pathname === "/admin/community/moderation" ? "page" : undefined}
            >
              <span className="link-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3l7 4v5c0 5-3.5 8-7 9-3.5-1-7-4-7-9V7l7-4Z" />
                  <path d="M8 12h8" />
                  <path d="M12 8v8" />
                </svg>
              </span>
              <span className="link-text">Moderation</span>
            </Link>
            <Link
              href="/admin/agent-sessions"
              prefetch={false}
              className={`sidebar-link ${pathname === "/admin/agent-sessions" || pathname?.startsWith("/admin/agent-sessions/") ? 'active' : ''}`}
              aria-current={pathname === "/admin/agent-sessions" || pathname?.startsWith("/admin/agent-sessions/") ? "page" : undefined}
            >
              <span className="link-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12h3l2-6 4 12 3-9 2 3h4" />
                </svg>
              </span>
              <span className="link-text">DJ Session Events</span>
            </Link>
            <Link
              href="/analytics/agent-quality"
              prefetch={false}
              className={`sidebar-link ${pathname === "/analytics/agent-quality" ? 'active' : ''}`}
              aria-current={pathname === "/analytics/agent-quality" ? "page" : undefined}
            >
              <span className="link-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 19V5" />
                  <path d="M4 19h16" />
                  <path d="m7 15 3-3 3 2 5-6" />
                </svg>
              </span>
              <span className="link-text">AI DJ Quality</span>
            </Link>
            <Link
              href="/admin/invitations"
              prefetch={false}
              className={`sidebar-link ${pathname === "/admin/invitations" ? 'active' : ''}`}
              aria-current={pathname === "/admin/invitations" ? "page" : undefined}
            >
              <span className="link-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="5" width="18" height="14" rx="2" />
                  <path d="m3 7 9 6 9-6" />
                </svg>
              </span>
              <span className="link-text">Invitations</span>
            </Link>
            <Link
              href="/admin/audit"
              prefetch={false}
              className={`sidebar-link ${pathname === "/admin/audit" ? 'active' : ''}`}
              aria-current={pathname === "/admin/audit" ? "page" : undefined}
            >
              <span className="link-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <path d="M14 2v6h6" />
                  <path d="M8 13h8" />
                  <path d="M8 17h5" />
                </svg>
              </span>
              <span className="link-text">Audit Log</span>
            </Link>
            <Link
              href="/admin/preview-measures"
              prefetch={false}
              className={`sidebar-link ${pathname === "/admin/preview-measures" ? 'active' : ''}`}
              aria-current={pathname === "/admin/preview-measures" ? "page" : undefined}
            >
              <span className="link-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 3v18h18" />
                  <path d="M7 15l4-4 3 3 5-6" />
                </svg>
              </span>
              <span className="link-text">Preview Measures</span>
            </Link>
            <Link
              href="/admin/remix-mark-check"
              prefetch={false}
              className={`sidebar-link ${pathname === "/admin/remix-mark-check" ? 'active' : ''}`}
              aria-current={pathname === "/admin/remix-mark-check" ? "page" : undefined}
            >
              <span className="link-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12h2l2-5 3 10 3-14 3 12 2-3h3" />
                </svg>
              </span>
              <span className="link-text">Remix Mark Check</span>
            </Link>
          </>
        ) : null}
        {showManagementRecoveryLink ? (
          <>
            <Link
              href="/admin/users"
              prefetch={false}
              className={`sidebar-link ${pathname === "/admin/users" || pathname?.startsWith("/admin/users/") ? 'active' : ''}`}
              aria-current={pathname === "/admin/users" || pathname?.startsWith("/admin/users/") ? "page" : undefined}
            >
              <span className="link-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M21 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </span>
              <span className="link-text">Users</span>
            </Link>
            <Link
              href="/admin/artist-claims"
              prefetch={false}
              className={`sidebar-link ${pathname === "/admin/artist-claims" ? 'active' : ''}`}
              aria-current={pathname === "/admin/artist-claims" ? "page" : undefined}
            >
              <span className="link-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="9" cy="8" r="4" />
                  <path d="M3 21v-2a6 6 0 0 1 12 0v2" />
                  <path d="m16 11 2 2 4-4" />
                </svg>
              </span>
              <span className="link-text">Artist Claims</span>
            </Link>
            <Link
              href="/admin/credit-requests"
              prefetch={false}
              className={`sidebar-link ${pathname === "/admin/credit-requests" ? 'active' : ''}`}
              aria-current={pathname === "/admin/credit-requests" ? "page" : undefined}
            >
              <span className="link-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M14.5 9a2.5 2.5 0 0 0-2.5-1.5c-1.4 0-2.5.8-2.5 2s1.1 1.7 2.5 2 2.5.8 2.5 2-1.1 2-2.5 2A2.5 2.5 0 0 1 9.5 15" />
                  <path d="M12 6v1.5" />
                  <path d="M12 16.5V18" />
                </svg>
              </span>
              <span className="link-text">Credit Requests</span>
            </Link>
            <Link
              href="/admin/billing-reconciliation"
              prefetch={false}
              className={`sidebar-link ${pathname === "/admin/billing-reconciliation" ? 'active' : ''}`}
              aria-current={pathname === "/admin/billing-reconciliation" ? "page" : undefined}
            >
              <span className="link-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="4" y="3" width="16" height="18" rx="2" />
                  <path d="M8 8h8" />
                  <path d="M8 12h8" />
                  <path d="M8 16h5" />
                </svg>
              </span>
              <span className="link-text">Billing Reconciliation</span>
            </Link>
            <Link
              href="/admin/notices"
              prefetch={false}
              className={`sidebar-link ${pathname === "/admin/notices" ? 'active' : ''}`}
              aria-current={pathname === "/admin/notices" ? "page" : undefined}
            >
              <span className="link-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1Z" />
                  <path d="M15.5 8.5a5 5 0 0 1 0 7" />
                  <path d="M18.5 5.5a9 9 0 0 1 0 13" />
                </svg>
              </span>
              <span className="link-text">Notices</span>
            </Link>
            <Link
              href="/admin/management-recovery"
              prefetch={false}
              className={`sidebar-link ${pathname === "/admin/management-recovery" ? 'active' : ''}`}
              aria-current={pathname === "/admin/management-recovery" ? "page" : undefined}
            >
              <span className="link-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3v6" />
                  <path d="M8 7H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3" />
                  <path d="m9 13 2 2 4-4" />
                </svg>
              </span>
              <span className="link-text">Transfer Recovery</span>
            </Link>
            <Link
              href="/admin/takedowns"
              prefetch={false}
              className={`sidebar-link ${pathname === "/admin/takedowns" ? 'active' : ''}`}
              aria-current={pathname === "/admin/takedowns" ? "page" : undefined}
            >
              <span className="link-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
                  <line x1="4" y1="22" x2="4" y2="15" />
                </svg>
              </span>
              <span className="link-text">Takedown Notices</span>
            </Link>
            <Link
              href="/admin/support"
              prefetch={false}
              className={`sidebar-link ${pathname === "/admin/support" ? 'active' : ''}`}
              aria-current={pathname === "/admin/support" ? "page" : undefined}
            >
              <span className="link-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </span>
              <span className="link-text">Support Requests</span>
            </Link>
            <Link
              href="/admin/usage-report"
              prefetch={false}
              className={`sidebar-link ${pathname === "/admin/usage-report" ? 'active' : ''}`}
              aria-current={pathname === "/admin/usage-report" ? "page" : undefined}
            >
              <span className="link-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="8" y1="13" x2="16" y2="13" />
                  <line x1="8" y1="17" x2="16" y2="17" />
                </svg>
              </span>
              <span className="link-text">Usage Report</span>
            </Link>
          </>
        ) : null}
        <button
          type="button"
          className="sidebar-link sidebar-link--button"
          onClick={() => setIsAboutOpen(true)}
        >
          <span className="link-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
          </span>
          <span className="link-text">About</span>
        </button>
      </nav>

      <AboutModal isOpen={isAboutOpen} onClose={() => setIsAboutOpen(false)} />
      {showUserChip ? (
        <div className="sidebar-footer">
          <button
            ref={accountButtonRef}
            type="button"
            className="user-profile"
            aria-label={`${accountName ? `Signed in as ${accountName}` : "Signed in"}. Account menu.`}
            aria-haspopup="menu"
            aria-expanded={accountMenuAt ? true : false}
            data-testid="sidebar-account-button"
            onClick={() => {
              if (accountMenuAt) {
                setAccountMenuAt(null);
                return;
              }
              const rect = accountButtonRef.current?.getBoundingClientRect();
              // Opens at the card's top edge; the menu flips above it when it
              // would spill past the bottom of the window.
              setAccountMenuAt(rect ? { x: rect.left, y: rect.top } : { x: 16, y: 16 });
            }}
          >
            <div className="user-avatar" aria-hidden="true">
              {userInitial || (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
                </svg>
              )}
            </div>
            <div className="user-info">
              <div className="user-name" title={primaryLabel}>{primaryLabel}</div>
              <div className="user-status">
                <span className="status-dot" />
                Signed in
              </div>
            </div>
          </button>
        </div>
      ) : null}
      {accountMenuAt ? (
        <ContextMenu
          x={accountMenuAt.x}
          y={accountMenuAt.y}
          items={accountMenuItems}
          onClose={() => setAccountMenuAt(null)}
          openerRef={accountButtonRef}
          ariaLabel="Account"
        />
      ) : null}
      </aside>
      {sidebarLayout.media === "wide" ? <SidebarResizeEdge sidebarRef={sidebarRef} layout={sidebarLayout.layout} /> : null}
    </>
  );
}
