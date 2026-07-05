"use client";

import Link from "next/link";
import { useAuth } from "../auth/AuthProvider";
import type { CampaignListStatus } from "../../lib/shows";

type ShowsCampaignFilterKey = "default" | "all" | CampaignListStatus;

type Props = {
  activeFilter: ShowsCampaignFilterKey;
};

const FILTERS: Array<{ key: ShowsCampaignFilterKey; label: string; href: string }> = [
  { key: "default", label: "Default", href: "/shows" },
  { key: "all", label: "All", href: "/shows?scope=all" },
  { key: "active", label: "Active", href: "/shows?status=active" },
  { key: "funded", label: "Funded", href: "/shows?status=funded" },
  { key: "cancelled", label: "Cancelled", href: "/shows?status=cancelled" },
  { key: "refund_available", label: "Refunds", href: "/shows?status=refund_available" },
  { key: "released", label: "Released", href: "/shows?status=released" },
];

export function ShowsCampaignFilters({ activeFilter }: Props) {
  const { role } = useAuth();
  const canFilter = role === "admin" || role === "operator";
  if (!canFilter) return null;

  return (
    <nav className="shows-page__filters" aria-label="Campaign status filter">
      {FILTERS.map((filter) => (
        <Link
          key={filter.key}
          href={filter.href}
          className="shows-page__filter-link"
          aria-current={filter.key === activeFilter ? "page" : undefined}
        >
          {filter.label}
        </Link>
      ))}
    </nav>
  );
}
