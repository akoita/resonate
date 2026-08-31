---
title: "SEO Metadata Management"
status: implemented
owner: "@akoita"
---

# SEO Metadata Management

Resonate gives public, shareable pages useful search and social-preview
metadata while keeping signed-in workspaces and operational screens out of
search indexes. The convention is centralized in `web/src/lib/seo.ts`; new
routes should use its builders instead of assembling metadata independently.

## Public pages

Public metadata includes a route-specific title and description, an absolute
canonical URL, Open Graph fields, Twitter card fields, and an image. When a
page has no safe artwork, it uses the application fallback image.

Dynamic public metadata may read only public endpoints and public or redacted
response fields. Artist, release, stem, Shows campaign, public community
profile, and curator routes follow this rule. A failed public lookup falls back
to generic metadata and must not expose an exception, authenticated response,
wallet ownership, support history, moderation state, or hidden profile data.

`NEXT_PUBLIC_SITE_URL` defines the deployed canonical origin. Local development
falls back to `http://localhost:3001`; deployments should always set the real
HTTPS origin.

## Private pages

Authenticated, administrative, and owner-management routes use the shared
private metadata builder. It emits explicit `noindex`, `nofollow`, `noarchive`,
and `noimageindex` directives. This covers settings and wallet pages, admin and
analytics screens, listener workspaces, artist management, Shows management,
Remix Studio, and seller management.

Robots metadata is defense in depth, not authorization. Private data must still
be protected by the backend and must never be included in server-rendered
metadata.

## Adding a route

1. Decide whether the route is intentionally public and discoverable or a
   private workspace. Do not infer discoverability merely because a URL can be
   opened without navigation.
2. For a public route, use `buildPublicMetadata` and provide the canonical path.
   Dynamic metadata must use only a public read and privacy-safe fields.
3. For a private route, use `buildPrivateMetadata` in the nearest layout so all
   descendants inherit the robots policy.
4. Add or update the route-policy test when the discoverability boundary
   changes.
5. Verify rendered metadata with the production build as well as focused unit
   tests.

## Validation

Run the focused metadata tests from `web/`:

```bash
npx vitest run src/lib/seo.test.ts src/lib/seoRoutePolicy.test.ts
```

The helper tests cover canonical URLs, social-image fallbacks, and robots
directives. The route-policy test keeps the named public and private route
boundaries from regressing silently.

## References

- [Issue #1101](https://github.com/akoita/resonate/issues/1101)
- [Deployment environment](../deployment/environment.md)
- [Change impact checklist](../engineering/change_impact_checklist.md)
