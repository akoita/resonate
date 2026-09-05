import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PRIVATE_ROBOTS } from "./seo";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../app");

const PRIVATE_LAYOUTS = [
  "admin/layout.tsx",
  "analytics/agent-quality/layout.tsx",
  "agent/layout.tsx",
  "artist/analytics/layout.tsx",
  "artist/catalog/layout.tsx",
  "artist/onboarding/layout.tsx",
  "artist/upload/layout.tsx",
  "collection/layout.tsx",
  "community/layout.tsx",
  "create/layout.tsx",
  "disputes/admin/layout.tsx",
  "import/layout.tsx",
  "library/layout.tsx",
  "marketplace/manage/layout.tsx",
  "player/layout.tsx",
  "remix/studio/[projectId]/layout.tsx",
  "settings/layout.tsx",
  "shows/[campaignId]/edit/layout.tsx",
  "shows/create/layout.tsx",
  "sonic-radar/layout.tsx",
  "wallet/layout.tsx",
];

const PUBLIC_DYNAMIC_ROUTES = [
  "artist/[id]/layout.tsx",
  "community/profile/[userId]/page.tsx",
  "curators/[address]/layout.tsx",
  "help/[slug]/page.tsx",
  "moments/[momentId]/page.tsx",
  "release/[id]/layout.tsx",
  "shows/[campaignId]/page.tsx",
  "stem/[tokenId]/layout.tsx",
];

function readRoute(relativePath: string): string {
  const absolutePath = path.join(APP_DIR, relativePath);
  expect(existsSync(absolutePath), `missing route file: ${relativePath}`).toBe(true);
  return readFileSync(absolutePath, "utf8");
}

describe("SEO route policy", () => {
  it("keeps every required private surface on the shared noindex metadata policy", () => {
    for (const route of PRIVATE_LAYOUTS) {
      const source = readRoute(route);
      expect(source, route).toMatch(/privateMetadata/);
      expect(source, route).toMatch(/export const metadata\s*=\s*privateMetadata/);
    }

    expect(PRIVATE_ROBOTS).toEqual({
      index: false,
      follow: false,
      noarchive: true,
      noimageindex: true,
      nosnippet: true,
    });
  });

  it("keeps named public dynamic routes server-metadata capable", () => {
    for (const route of PUBLIC_DYNAMIC_ROUTES) {
      expect(readRoute(route), route).toMatch(/export async function generateMetadata/);
    }
  });
});
