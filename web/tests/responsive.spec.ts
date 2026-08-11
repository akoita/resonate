import { test, expect } from "@playwright/test";

/*
 * Cross-viewport smoke test for #557.
 * Runs on chromium / chromium-tablet / chromium-mobile (see playwright.config).
 * Goal: prove the app renders without horizontal overflow and that the
 * phone drawer nav actually works — not to re-run every per-flow spec
 * against three viewports (that would triple CI time).
 *
 * `mode: serial` — under parallel workers + a single Next.js dev server,
 * the first-compile queue + React hydration race can swallow hamburger
 * clicks. Running these tests serially within each project removes the
 * race; they still parallelize across the 3 viewport projects. Retries
 * further guard against the rare compile-burst that can still nuke a
 * click under heavy CI load.
 */
test.describe.configure({ mode: "serial", retries: 2 });

const ROUTES = ["/", "/library", "/marketplace", "/wallet"] as const;

const LONG_DROP_VALUE = "UnbrokenCollectibleContextValueThatMustNeverWidenTheMobileDropsCard";

const FEATURED_DROP_RESPONSE = {
  items: [
    {
      id: "drop_responsive",
      trackId: "track_responsive",
      artistId: "artist_responsive",
      status: "published",
      title: `${LONG_DROP_VALUE}Title`,
      description: null,
      createdAt: "2026-08-11T00:00:00.000Z",
      updatedAt: "2026-08-11T00:00:00.000Z",
      publishedAt: "2026-08-11T00:00:00.000Z",
      rightsLabel: "NON_COMMERCIAL_COLLECTIBLE",
      rightsSummary: "Personal collectible",
      moments: [
        {
          id: "moment_responsive",
          title: `${LONG_DROP_VALUE}MomentTitle`,
          lyricText: `${LONG_DROP_VALUE}LyricPoster`,
          artworkUrl: null,
          sourceStemType: "vocals",
          startMs: 0,
          endMs: 10_000,
          clipAssetUri: null,
          editionSize: 100,
          priceCents: 250,
          rightsLabel: `NON_COMMERCIAL_COLLECTIBLE_${LONG_DROP_VALUE}`,
          collectedCount: 12,
        },
      ],
      unlock: null,
      context: {
        trackTitle: `${LONG_DROP_VALUE}Track`,
        releaseId: "release_responsive",
        releaseTitle: "Responsive release",
        releaseHasArtwork: false,
        artistName: `${LONG_DROP_VALUE}Artist`,
      },
    },
  ],
};

for (const route of ROUTES) {
  test(`no horizontal overflow at ${route}`, async ({ page }) => {
    await page.goto(route);
    // Let layout settle — some pages lazy-load content.
    await page.waitForLoadState("domcontentloaded");

    const overflow = await page.evaluate(() => {
      const el = document.documentElement;
      return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
    });

    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
  });
}

test("phone hamburger opens the sidebar drawer", async ({ page, viewport }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-mobile", "phone-only check");
  expect(viewport?.width ?? 0).toBeLessThan(768);

  await page.goto("/");
  // Wait for React hydration: under parallel dev-server load the initial
  // HTML arrives before the handlers are attached, so early clicks no-op.
  await page.waitForLoadState("networkidle");
  const hamburger = page.getByRole("button", { name: /open navigation/i });
  await expect(hamburger).toBeVisible();

  const drawerLink = page.getByRole("link", { name: "Library" });
  const backdrop = page.locator(".sidebar-backdrop");
  // Click-retry pattern immune to hydration race under heavy parallel
  // worker load. Hamburger toggles, so only click when drawer is closed.
  // Dispatching via `el.click()` avoids pointer/tap event quirks under
  // touch emulation.
  await expect(async () => {
    if ((await backdrop.count()) === 0) {
      await hamburger.evaluate((el) => (el as HTMLElement).click());
    }
    await expect(drawerLink).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 25000 });
});

test("desktop hides the hamburger", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "desktop-only check");

  await page.goto("/");
  const hamburger = page.getByRole("button", { name: /open navigation/i });
  await expect(hamburger).toBeHidden();
});

test("tablet collapses sidebar labels (icon-only rail)", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-tablet", "tablet-only check");

  await page.goto("/");
  // Sidebar renders, but the label text is hidden by the tablet media query.
  const homeLabel = page.locator(".app-sidebar .link-text", { hasText: "Home" });
  await expect(homeLabel).toBeAttached();
  await expect(homeLabel).toBeHidden();
});

test("phone backdrop click closes the drawer", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-mobile", "phone-only check");

  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const hamburger = page.getByRole("button", { name: /open navigation/i });
  await expect(hamburger).toBeVisible();

  const backdrop = page.locator(".sidebar-backdrop");
  // Click-and-verify retry loop. Under parallel worker load the first
  // click can land before React has finished attaching its handler even
  // after `networkidle`, and the state toggle is lost. The hamburger
  // toggles (not opens), so blind retries would alternate open/close —
  // only click if the drawer isn't already open. On touch-emulated
  // mobile, dispatch the click directly on the element so we bypass
  // the pointer/tap flow entirely.
  await expect(async () => {
    if ((await backdrop.count()) === 0) {
      await hamburger.evaluate((el) => (el as HTMLElement).click());
    }
    await expect(backdrop).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 25000 });

  // The backdrop uses `position: fixed; inset: 0;` so it spans the whole
  // viewport, but the drawer sits on top of its left portion. Clicking
  // the geometric center would hit a drawer sidebar link. Dispatch the
  // click directly to the backdrop element — this is what the user
  // effectively does when tapping the visible-to-them scrim area.
  await backdrop.evaluate((el) => (el as HTMLElement).click());
  await expect(backdrop).toHaveCount(0);
  // Sidebar drawer itself should slide off-screen (lose its .open class).
  await expect(page.locator(".app-sidebar.open")).toHaveCount(0);
});

test("phone Drops card stays contained with long content and the player", async (
  { page },
  testInfo,
) => {
  test.skip(testInfo.project.name !== "chromium-mobile", "phone-only check");

  await page.route("**/punchline/featured?limit=6", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(FEATURED_DROP_RESPONSE),
    });
  });

  for (const width of [320, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");

    const card = page.getByTestId("drops-shelf-card");
    await expect(card).toBeVisible({ timeout: 20_000 });
    await card.scrollIntoViewIfNeeded();

    const layout = await card.evaluate((element) => {
      const cardElement = element as HTMLElement;
      const gridElement = cardElement.parentElement as HTMLElement;
      const cardRect = cardElement.getBoundingClientRect();
      const gridRect = gridElement.getBoundingClientRect();
      const requiredSelectors = [
        ".punchline-card",
        ".punchline-card-art",
        ".punchline-card-wave",
        ".punchline-card-title",
        ".punchline-card-meta",
        ".punchline-card-rights",
        ".ng-drops-card__context",
      ];

      return {
        viewportWidth: window.innerWidth,
        card: {
          left: cardRect.left,
          right: cardRect.right,
          clientWidth: cardElement.clientWidth,
          scrollWidth: cardElement.scrollWidth,
        },
        grid: {
          left: gridRect.left,
          right: gridRect.right,
          clientWidth: gridElement.clientWidth,
          scrollWidth: gridElement.scrollWidth,
        },
        children: requiredSelectors.map((selector) => {
          const child = cardElement.querySelector(selector) as HTMLElement | null;
          const rect = child?.getBoundingClientRect();
          return {
            selector,
            exists: Boolean(child),
            left: rect?.left ?? 0,
            right: rect?.right ?? 0,
          };
        }),
        wrappedText: [
          ".punchline-card-art-lyric",
          ".punchline-card-title",
          ".ng-drops-card__artist",
          ".ng-drops-card__track",
        ].map((selector) => {
          const child = cardElement.querySelector(selector) as HTMLElement;
          return { selector, overflowWrap: getComputedStyle(child).overflowWrap };
        }),
      };
    });

    expect(layout.card.scrollWidth, `${width}px card scroll width`).toBeLessThanOrEqual(
      layout.card.clientWidth + 1,
    );
    expect(layout.grid.scrollWidth, `${width}px grid scroll width`).toBeLessThanOrEqual(
      layout.grid.clientWidth + 1,
    );
    expect(layout.card.left, `${width}px card left edge`).toBeGreaterThanOrEqual(
      layout.grid.left - 1,
    );
    expect(layout.card.right, `${width}px card right edge`).toBeLessThanOrEqual(
      layout.grid.right + 1,
    );
    expect(layout.card.left, `${width}px viewport left edge`).toBeGreaterThanOrEqual(-1);
    expect(layout.card.right, `${width}px viewport right edge`).toBeLessThanOrEqual(
      layout.viewportWidth + 1,
    );

    for (const child of layout.children) {
      expect(child.exists, `${width}px ${child.selector} exists`).toBe(true);
      expect(child.left, `${width}px ${child.selector} left edge`).toBeGreaterThanOrEqual(
        layout.card.left - 1,
      );
      expect(child.right, `${width}px ${child.selector} right edge`).toBeLessThanOrEqual(
        layout.card.right + 1,
      );
    }
    for (const text of layout.wrappedText) {
      expect(text.overflowWrap, `${width}px ${text.selector} wrapping`).toBe("anywhere");
    }

    // Exercise the real mobile player CSS without coupling this layout test to
    // player persistence internals. The app content's reserved bottom space
    // must let the complete card scroll above the persistent overlay.
    const player = page.locator("[data-testid=responsive-player]");
    await page.locator(".app-main").evaluate((appMain) => {
      const existing = appMain.querySelector("[data-testid=responsive-player]");
      if (existing) existing.remove();
      const overlay = document.createElement("div");
      overlay.className = "app-player";
      overlay.dataset.testid = "responsive-player";
      appMain.appendChild(overlay);
    });
    await expect(player).toBeVisible();
    await card.evaluate((element) => element.scrollIntoView({ block: "center" }));

    const clearance = await card.evaluate((element) => {
      const content = document.querySelector(".app-content") as HTMLElement;
      const playerElement = document.querySelector(
        "[data-testid=responsive-player]",
      ) as HTMLElement;
      return {
        cardBottom: element.getBoundingClientRect().bottom,
        playerTop: playerElement.getBoundingClientRect().top,
        contentBottomPadding: Number.parseFloat(getComputedStyle(content).paddingBottom),
      };
    });
    expect(clearance.contentBottomPadding).toBeGreaterThanOrEqual(140);
    expect(clearance.cardBottom, `${width}px player clearance`).toBeLessThanOrEqual(
      clearance.playerTop + 1,
    );

    await testInfo.attach(`drops-card-${width}px`, {
      body: await card.screenshot(),
      contentType: "image/png",
    });
  }
});
