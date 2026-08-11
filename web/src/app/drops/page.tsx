import type { Metadata } from "next";
import {
  DropsBrowseView,
  parseDropsBrowseQuery,
  type DropsSearchParams,
} from "../../components/drops/DropsBrowseView";
import { fetchDropsBrowse } from "../../lib/api";

export const metadata: Metadata = {
  title: "Drops",
  description: "Browse scarce, non-commercial music moments from Resonate artists.",
};

export default async function DropsPage({
  searchParams,
}: {
  searchParams?: Promise<DropsSearchParams>;
}) {
  const query = parseDropsBrowseQuery(await searchParams);
  let result;
  try {
    result = await fetchDropsBrowse({
      page: query.page,
      limit: 24,
      kind: query.kind,
      ...(query.genre ? { genre: query.genre } : {}),
      price: query.price,
      availability: query.includeSoldOut ? "all" : "available",
    });
  } catch {
    return <DropsBrowseView query={query} failed />;
  }
  return <DropsBrowseView result={result} query={query} />;
}
