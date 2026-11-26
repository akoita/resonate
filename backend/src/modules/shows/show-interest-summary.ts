import type { ShowCampaignMode } from "./show-interest.dto";

/**
 * Shows "I would come" counts (#2668), shared by the campaign page summary and
 * artist analytics (#2686) so both always agree. Pure: no database, no Nest.
 */

export interface ShowInterestSummary {
  mode: ShowCampaignMode;
  total: number;
  /** Cities with at least `minimumGroup` people, largest first. */
  cities: Array<{ city: string; count: number }>;
  /** People in smaller cities, or who gave no city, counted together. */
  otherCount: number;
  /** People who asked to be told when tickets or pledges open. */
  notifyCount: number;
  minimumGroup: number;
}

/** Group key: case- and accent-insensitive, so "Lyon" and "lyon" count together. */
function cityKey(city: string): string {
  return city.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/**
 * Counts by city. A city with fewer than `minimumGroup` people is folded into
 * `otherCount`, so nobody in a small town can be singled out. Pure for tests.
 */
export function summarizeInterest(
  rows: Array<{ city: string | null; notifyWhenOpen: boolean }>,
  mode: ShowCampaignMode,
  minimumGroup: number,
): ShowInterestSummary {
  const groups = new Map<string, { city: string; count: number }>();
  let noCity = 0;
  for (const row of rows) {
    if (!row.city) {
      noCity += 1;
      continue;
    }
    const key = cityKey(row.city);
    const group = groups.get(key);
    if (group) group.count += 1;
    else groups.set(key, { city: row.city, count: 1 });
  }
  const cities: Array<{ city: string; count: number }> = [];
  let otherCount = noCity;
  for (const group of groups.values()) {
    if (group.count >= minimumGroup) cities.push(group);
    else otherCount += group.count;
  }
  cities.sort((a, b) => b.count - a.count || a.city.localeCompare(b.city));
  return {
    mode,
    total: rows.length,
    cities,
    otherCount,
    notifyCount: rows.filter((row) => row.notifyWhenOpen).length,
    minimumGroup,
  };
}
