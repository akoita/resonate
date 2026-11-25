import type { MetadataRoute } from "next";

/**
 * robots.txt for the web app. Crawling stays allowed on every deployment so
 * crawlers can read each page's robots meta tag (see `publicRobots` in
 * `lib/seo.ts`): a deployment that has not opted in to indexing serves
 * `noindex` on its public pages, and a `Disallow: /` here would hide that tag
 * and let bare URLs be listed from outside links.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
  };
}
