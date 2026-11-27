---
title: "Product surface switches"
status: implemented
owner: "@akoita"
---

# Product surface switches

**Status:** implemented (application half, #2658). The values per environment
are deployment configuration in `resonate-iac`.
**Audience:** operators, backend and web developers

## What it is for

One named switch per surface where money moves or where generative AI runs, so
a deployment can offer the product without a payment, pledge, purchase, wallet
or AI-generation action, and turn any of them back on without new code.

| Surface | Variable | Web entry points hidden when off |
| --- | --- | --- |
| Shows pledging | `SHOWS_PLEDGING_ENABLED` | The pledge panel on a campaign page (a short note replaces it) |
| Paid collects | `PAID_COLLECTS_ENABLED` | The priced Collect button on a drop (free collects stay) |
| Stem and licence buying | `STEM_PURCHASES_ENABLED` | Buy buttons and licence chips in the marketplace and on a stem page; the crate quote panel |
| Wallet | `WALLET_ENABLED` | The Wallet page; the account chip opens Settings instead (the sidebar has no Wallet item since #2663) |
| Agent payments | `AGENT_PAYMENTS_ENABLED` | None today (the web app no longer offers agent purchases); backend refusal only |
| AI generation | `AI_GENERATION_ENABLED` | The Create with AI item (last in the artist group) and page; prompted remix drafts answer "not enabled" in Remix Studio |

### Navigation switches (#2663)

These hide entry points to surfaces that are not ready to show newcomers. Their routes stay reachable by direct link and the backend does not refuse them. Same defaults as above.

| Surface | Variable | Web entry points hidden when off |
| --- | --- | --- |
| Disputes | `DISPUTES_ENABLED` | The Disputes item in the artist group |
| Community rooms and cohorts | `COMMUNITY_ENABLED` | The Community sidebar item; the Community tab on artist pages; the Open Community card in Settings |
| Scene Scout cards | `SCENE_SCOUT_ENABLED` | The Scene Scout panel in artist analytics |
| Sonic Radar | `SONIC_RADAR_ENABLED` | The sidebar item, shown under Library only once the listener's journal has discoveries (checked once per page load, after the page settles); otherwise Sonic Radar is reached from the AI DJ |
| Desktop app link | `DESKTOP_APP_ENABLED` | The desktop app suggestion in Settings → Library |

## How it works

- `backend/src/config/product_surfaces.ts` resolves each switch per request.
  Default on, except when `RESONATE_ENVIRONMENT_ID` names a production tier,
  where every switch is off unless set to `true`. An unreadable value is off.
- `@RequireSurface(surface)` (`backend/src/modules/product_surfaces/`) refuses
  a route with `403 { code: "surface_disabled", surface }`. The gated routes
  are pinned in `product_surface_routes.spec.ts`. Routes that complete an
  already-paid action (confirm, settle, refund) stay open.
- `GET /config/surfaces` reports the resolved values. The web app reads them
  through `useProductSurfaces()` / `<SurfaceGate>`; every surface counts as off
  until they load, so a switched-off entry point never flashes.
- User Guide articles list the surfaces they describe (`surfaces` on the
  article) and show a "not offered in this version" note when one is off.

## How to test

- Backend: `product_surfaces.spec.ts`, `product_surface_routes.spec.ts`,
  `product_surfaces.controller.http.spec.ts`.
- Web: `src/lib/productSurfaces.test.ts`, `src/components/system/SurfaceGate.test.tsx`.
- Locally, set for example `STEM_PURCHASES_ENABLED=false` on the backend and
  reload: buy buttons disappear and `GET /api/stems/:id/x402` answers 403.

Variables: [Environment Variables, Product Surface Switches](../deployment/environment.md#product-surface-switches).
