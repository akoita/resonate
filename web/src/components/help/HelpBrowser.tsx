"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";

import { searchArticles } from "../../lib/help/search";
import { STATUS_LABELS, type AudienceMeta, type CategoryMeta } from "../../lib/help/taxonomy";
import type { HelpAudience, HelpIndexEntry } from "../../lib/help/types";

type AudienceFilter = HelpAudience | "all";

interface Props {
  entries: HelpIndexEntry[];
  categories: CategoryMeta[];
  audiences: AudienceMeta[];
}

/**
 * Search + persona filter over the guide. Server-renders the full grouped
 * list (so it works with JS disabled), then enhances with live filtering.
 */
export function HelpBrowser({ entries, categories, audiences }: Props) {
  const [query, setQuery] = useState("");
  const [audience, setAudience] = useState<AudienceFilter>("all");
  const searchId = useId();

  const audienceFiltered = useMemo(
    () => (audience === "all" ? entries : entries.filter((e) => e.audiences.includes(audience))),
    [entries, audience],
  );

  const results = useMemo(() => searchArticles(audienceFiltered, query), [audienceFiltered, query]);

  const trimmedQuery = query.trim();
  const isFiltering = trimmedQuery.length > 0 || audience !== "all";

  const grouped = useMemo(
    () =>
      categories
        .map((category) => ({ category, items: results.filter((r) => r.category === category.id) }))
        .filter((group) => group.items.length > 0),
    [categories, results],
  );

  const countLabel = isFiltering
    ? `${results.length} ${results.length === 1 ? "guide" : "guides"}${trimmedQuery ? ` for “${trimmedQuery}”` : ""}`
    : `${entries.length} guides`;

  return (
    <div className="help-browser">
      <form className="help-search" role="search" onSubmit={(e) => e.preventDefault()}>
        <label htmlFor={searchId} className="help-sr-only">
          Search the guide
        </label>
        <div className="help-search__field">
          <SearchIcon />
          <input
            id={searchId}
            type="search"
            className="help-search__input"
            placeholder="Search — try “passkey”, “remix”, or “refund”…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
          />
          {query ? (
            <button
              type="button"
              className="help-search__clear"
              onClick={() => setQuery("")}
              aria-label="Clear search"
            >
              ×
            </button>
          ) : null}
        </div>
      </form>

      <div className="help-filter" role="group" aria-label="Filter guides by who you are">
        <button
          type="button"
          className={`help-filter__btn ${audience === "all" ? "is-active" : ""}`}
          aria-pressed={audience === "all"}
          onClick={() => setAudience("all")}
        >
          All
        </button>
        {audiences.map((a) => (
          <button
            key={a.id}
            type="button"
            className={`help-filter__btn ${audience === a.id ? "is-active" : ""}`}
            aria-pressed={audience === a.id}
            onClick={() => setAudience(a.id)}
            title={a.blurb}
          >
            {a.label}
          </button>
        ))}
      </div>

      <p className="help-browser__count" role="status" aria-live="polite">
        {countLabel}
      </p>

      {results.length === 0 ? (
        <div className="help-empty">
          <p>No guides match that yet.</p>
          <button
            type="button"
            className="help-textbtn"
            onClick={() => {
              setQuery("");
              setAudience("all");
            }}
          >
            Clear filters
          </button>
        </div>
      ) : isFiltering ? (
        <section className="help-catsection" aria-labelledby="help-results-h">
          <h2 id="help-results-h" className="help-sr-only">
            Matching guides
          </h2>
          <ul className="help-cardgrid">
            {results.map((entry) => (
              <HelpCard key={entry.slug} entry={entry} />
            ))}
          </ul>
        </section>
      ) : (
        grouped.map((group) => (
          <section
            key={group.category.id}
            className="help-catsection"
            aria-labelledby={`cat-${group.category.id}`}
          >
            <div className="help-catsection__head">
              <h2 id={`cat-${group.category.id}`} className="help-catsection__title">
                {group.category.label}
              </h2>
              <p className="help-catsection__blurb">{group.category.blurb}</p>
            </div>
            <ul className="help-cardgrid">
              {group.items.map((entry) => (
                <HelpCard key={entry.slug} entry={entry} />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function HelpCard({ entry }: { entry: HelpIndexEntry }) {
  return (
    <li className="help-card">
      <Link href={`/help/${entry.slug}`} className="help-card__link">
        <h3 className="help-card__title">{entry.title}</h3>
        <p className="help-card__summary">{entry.summary}</p>
        {entry.status !== "available" ? (
          <span className={`help-chip help-chip--status help-chip--${entry.status}`}>
            {STATUS_LABELS[entry.status]}
          </span>
        ) : null}
      </Link>
    </li>
  );
}

function SearchIcon() {
  return (
    <svg
      className="help-search__icon"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}
