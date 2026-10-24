import { isStemSource, type StemSourceFilter } from "./stemSource";

/**
 * The query of one page of active marketplace listings (Browse stems,
 * `/crates?tab=stems`). Kept apart from the component so the source filter
 * (#1976, #2379) is testable: "all" sends no `source`, "official" and
 * "separated" send exactly that value, and anything else is never forwarded.
 */
export function buildMarketplaceListingsParams(input: {
  limit: number;
  offset: number;
  sortBy: string;
  search?: string;
  source?: StemSourceFilter | string | null;
  excludeSeller?: string | null;
}): URLSearchParams {
  const params = new URLSearchParams({
    status: "active",
    limit: String(input.limit),
    offset: String(input.offset),
    sortBy: input.sortBy,
  });
  if (input.search) params.set("search", input.search);
  if (isStemSource(input.source)) params.set("source", input.source);
  if (input.excludeSeller) params.set("excludeSeller", input.excludeSeller);
  return params;
}
