import Link from "next/link";
import type {
  DropsBrowseKind,
  DropsBrowsePrice,
  DropsBrowseResponse,
} from "../../lib/api";
import { DropDiscoveryCard } from "./DropDiscoveryCard";
import { DropsBrowseImpressions } from "./DropsBrowseImpressions";

export type DropsSearchParams = Record<string, string | string[] | undefined>;

export type DropsBrowseQuery = {
  page: number;
  kind: DropsBrowseKind;
  genre: string;
  price: DropsBrowsePrice;
  includeSoldOut: boolean;
};

const KINDS = new Set<DropsBrowseKind>(["all", "punchline"]);
const PRICES = new Set<DropsBrowsePrice>(["all", "free", "paid"]);

function firstParam(params: DropsSearchParams | undefined, key: string) {
  const value = params?.[key];
  return Array.isArray(value) ? value[0] : value;
}

/** Normalizes hostile/stale URLs before they reach the strict backend DTO. */
export function parseDropsBrowseQuery(
  params: DropsSearchParams | undefined,
): DropsBrowseQuery {
  const rawPage = firstParam(params, "page");
  const parsedPage = rawPage ? Number(rawPage) : 1;
  const rawKind = firstParam(params, "kind") as DropsBrowseKind | undefined;
  const rawPrice = firstParam(params, "price") as DropsBrowsePrice | undefined;
  const genre = firstParam(params, "genre")?.trim() ?? "";

  return {
    page:
      Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1,
    kind: rawKind && KINDS.has(rawKind) ? rawKind : "all",
    genre: genre.slice(0, 100),
    price: rawPrice && PRICES.has(rawPrice) ? rawPrice : "all",
    includeSoldOut: firstParam(params, "includeSoldOut") === "1",
  };
}

/** Builds canonical shareable filter/paging links without dropping state. */
export function dropsBrowseHref(
  query: DropsBrowseQuery,
  overrides: Partial<DropsBrowseQuery> = {},
) {
  const next = { ...query, ...overrides };
  const params = new URLSearchParams();
  if (next.page > 1) params.set("page", String(next.page));
  if (next.kind !== "all") params.set("kind", next.kind);
  if (next.genre) params.set("genre", next.genre);
  if (next.price !== "all") params.set("price", next.price);
  if (next.includeSoldOut) params.set("includeSoldOut", "1");
  const suffix = params.toString();
  return suffix ? `/drops?${suffix}` : "/drops";
}

type FilterChip = {
  label: string;
  active: boolean;
  override: Partial<DropsBrowseQuery>;
};

function FilterRow({
  id,
  label,
  chips,
  query,
}: {
  id: string;
  label: string;
  chips: FilterChip[];
  query: DropsBrowseQuery;
}) {
  const labelId = `drops-filter-${id}`;
  return (
    <div className="ng-tuner__row">
      <span className="ng-tuner__label" id={labelId}>
        {label}
      </span>
      <div className="ng-tuner__chips" role="group" aria-labelledby={labelId}>
        {chips.map((chip, index) => (
          <Link
            key={`${index}:${chip.label}`}
            href={dropsBrowseHref(query, { ...chip.override, page: 1 })}
            className={`ng-chip ${chip.active ? "ng-chip--active" : ""}`}
            aria-current={chip.active ? "true" : undefined}
            scroll={false}
          >
            {chip.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

/**
 * Tuner-style filter deck. Every chip is a plain link to the canonical
 * filtered URL, so filtering is instant, shareable, and works without JS;
 * choosing a filter always returns to the first page.
 */
function DropsFilterDeck({
  query,
  genres,
}: {
  query: DropsBrowseQuery;
  genres: string[];
}) {
  const genreOptions =
    query.genre && !genres.includes(query.genre) ? [query.genre, ...genres] : genres;
  const isDefault =
    query.kind === "all" &&
    query.genre === "" &&
    query.price === "all" &&
    !query.includeSoldOut;

  return (
    <section className="ng-filter-deck" aria-labelledby="drops-filter-title">
      <h2 id="drops-filter-title" className="drops-visually-hidden">
        Filter Drops
      </h2>
      <FilterRow
        id="kind"
        label="Kind"
        query={query}
        chips={[
          { label: "All", active: query.kind === "all", override: { kind: "all" } },
          { label: "Punchline", active: query.kind === "punchline", override: { kind: "punchline" } },
        ]}
      />
      <FilterRow
        id="genre"
        label="Genre"
        query={query}
        chips={[
          { label: "All genres", active: query.genre === "", override: { genre: "" } },
          ...genreOptions.map((genre) => ({
            label: genre,
            active: query.genre === genre,
            override: { genre },
          })),
        ]}
      />
      <FilterRow
        id="price"
        label="Price"
        query={query}
        chips={[
          { label: "All", active: query.price === "all", override: { price: "all" } },
          { label: "Free", active: query.price === "free", override: { price: "free" } },
          { label: "Paid", active: query.price === "paid", override: { price: "paid" } },
        ]}
      />
      <FilterRow
        id="availability"
        label="Availability"
        query={query}
        chips={[
          { label: "Available now", active: !query.includeSoldOut, override: { includeSoldOut: false } },
          { label: "Include sold out", active: query.includeSoldOut, override: { includeSoldOut: true } },
        ]}
      />
      {!isDefault && (
        <Link href="/drops" className="ng-section-link ng-filter-deck__clear" scroll={false}>
          Clear filters
        </Link>
      )}
    </section>
  );
}

export function DropsBrowseView({
  result,
  query,
  failed = false,
}: {
  result?: DropsBrowseResponse;
  query: DropsBrowseQuery;
  failed?: boolean;
}) {
  const genres = result?.facets.genres ?? [];
  const hasFilters =
    query.kind !== "all" || query.genre !== "" || query.price !== "all";
  const pageOutOfRange =
    result !== undefined &&
    result.items.length === 0 &&
    result.meta.totalCount > 0 &&
    query.page > result.meta.totalPages;
  const retryHref = dropsBrowseHref(query);

  return (
    <main className="home-ng drops-page">
      <div className="ng-main">
        <header className="drops-hero">
          <span className="ng-kicker ng-kicker--violet">Collection gallery</span>
          <h1>Own the moments.</h1>
          <p>
            Discover scarce, non-commercial keepsakes cut from the lines fans
            remember. Looking for music you can build with?{" "}
            <Link href="/marketplace">License the ingredients</Link>.
          </p>
        </header>

        <DropsFilterDeck query={query} genres={genres} />

        {failed ? (
          <section className="drops-state" role="alert">
            <h2>We couldn&apos;t load Drops.</h2>
            <p>Try the gallery again in a moment.</p>
            <Link href={retryHref}>Retry</Link>
          </section>
        ) : result && result.items.length > 0 ? (
          <section className="ng-section drops-results" aria-label="Drops gallery">
            <div className="drops-results-heading">
              <h2 className="ng-section-title">Gallery</h2>
              <p>
                {result.meta.totalCount} {result.meta.totalCount === 1 ? "drop" : "drops"}
              </p>
            </div>
            <DropsBrowseImpressions drops={result.items} />
            <div className="ng-grid-3 drops-grid">
              {result.items.map((drop) => (
                <DropDiscoveryCard
                  key={drop.id}
                  drop={drop}
                  price={query.price}
                  testId="drops-browse-card"
                  enablePreview
                />
              ))}
            </div>
            {(result.meta.page > 1 || result.meta.hasNextPage) && (
              <nav className="drops-pagination" aria-label="Drops pages">
                {result.meta.page > 1 ? (
                  <Link href={dropsBrowseHref(query, { page: result.meta.page - 1 })}>
                    ← Previous
                  </Link>
                ) : (
                  <span />
                )}
                <span>
                  Page {result.meta.page} of {result.meta.totalPages}
                </span>
                {result.meta.hasNextPage ? (
                  <Link href={dropsBrowseHref(query, { page: result.meta.page + 1 })}>
                    Next →
                  </Link>
                ) : (
                  <span />
                )}
              </nav>
            )}
          </section>
        ) : (
          <section className="drops-state">
            {pageOutOfRange ? (
              <>
                <h2>That Drops page is empty.</h2>
                <p>The gallery has fewer pages than this address requested.</p>
                <Link href={dropsBrowseHref(query, { page: 1 })}>
                  Back to the first page
                </Link>
              </>
            ) : hasFilters ? (
              <>
                <h2>No Drops match these filters.</h2>
                <p>Try a different kind, genre, price, or availability.</p>
                <Link href="/drops">Clear filters</Link>
              </>
            ) : query.includeSoldOut ? (
              <>
                <h2>No published Drops yet.</h2>
                <p>Published collections will appear here.</p>
              </>
            ) : (
              <>
                <h2>No Drops to collect yet.</h2>
                <p>New available collections will appear here.</p>
              </>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
