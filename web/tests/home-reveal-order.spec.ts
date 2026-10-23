/**
 * Home reveal order (#2254).
 *
 * Trending Now / Top Artists must not paint real content and then get pushed
 * down when the personalized feed lands above them. The API is mocked so the
 * feed is slower than the popularity rails (the production ordering), and the
 * page is watched frame by frame.
 *
 * What is measured: the distance from the bottom of the tuner to the top of the
 * *real* (non-skeleton) Trending Now section. Hero/campaign timing moves the
 * tuner and the section together, so it cancels out; anything that lands
 * between them (the feed) changes it. It must be a single value from the first
 * frame the real section paints.
 */
import { test, expect } from "./auth.setup";
import type { Page } from "@playwright/test";

const popularity = (extra: Record<string, unknown>) => ({
  window: "7d",
  genre: null,
  minimumAudience: 3,
  ...extra,
});

const trendingItem = {
  rank: 1,
  trackId: "trk_reveal_1",
  title: "Reveal Anthem",
  artist: "Reveal Artist",
  artistId: "art_reveal_1",
  releaseId: "rel_reveal_1",
  releaseTitle: "Reveal Release",
  genre: "Electronic",
  artworkUrl: null,
  artworkMimeType: null,
  score: 3,
  plays: 4,
  uniqueListeners: 4,
  saves: 0,
};

const artistItem = {
  rank: 1,
  artistId: "art_reveal_1",
  name: "Reveal Artist",
  imageUrl: null,
  score: 5,
  plays: 7,
  uniqueListeners: 4,
  saves: 1,
};

const feedBody = {
  userId: "test-user",
  requestId: "req-reveal",
  cold: false,
  rails: [
    {
      id: "because_genre",
      kind: "because_genre",
      title: "Because you play Electronic",
      explanation: "Ranked for your Electronic taste.",
      items: [
        {
          id: "trk_feed_1",
          title: "Feed Pick",
          artist: "Feed Artist",
          artistId: "art_feed_1",
          releaseId: "rel_feed_1",
          releaseTitle: "Feed Release",
          genre: "Electronic",
          moods: [],
          artworkMimeType: null,
          reasons: ["genre:Electronic"],
        },
      ],
    },
  ],
};

const FEED_DELAY_MS = 1200;

async function mockPopularity(page: Page) {
  await page.route("**/catalog/trending**", (route) =>
    route.fulfill({ json: popularity({ items: [trendingItem] }) }),
  );
  await page.route("**/catalog/top-artists**", (route) =>
    route.fulfill({ json: popularity({ items: [artistItem] }) }),
  );
}

/** Frame-by-frame recorder, installed before any page script runs. */
async function installRevealRecorder(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __reveal: {
        gaps: number[];
        firstTrendingAt: number | null;
        firstFeedAt: number | null;
        sawFeedSkeleton: boolean;
      };
    };
    w.__reveal = { gaps: [], firstTrendingAt: null, firstFeedAt: null, sawFeedSkeleton: false };
    const heading = (root: ParentNode, text: string, skeleton: boolean) =>
      Array.from(root.querySelectorAll("section.ng-shelf")).find(
        (section) =>
          section.classList.contains("ng-shelf--skeleton") === skeleton &&
          section.querySelector("h3")?.textContent?.trim() === text,
      );
    const tick = () => {
      const now = performance.now();
      const tuner = document.querySelector(".ng-tuner");
      const trending = heading(document, "Trending Now", false);
      if (tuner && trending) {
        const gap = Math.round(
          trending.getBoundingClientRect().top - tuner.getBoundingClientRect().bottom,
        );
        if (w.__reveal.firstTrendingAt === null) w.__reveal.firstTrendingAt = now;
        if (!w.__reveal.gaps.includes(gap)) w.__reveal.gaps.push(gap);
      }
      if (
        w.__reveal.firstFeedAt === null &&
        Array.from(document.querySelectorAll("section.ng-shelf:not(.ng-shelf--skeleton) h3")).some(
          (h) => h.textContent?.trim() === "Because you play Electronic",
        )
      ) {
        w.__reveal.firstFeedAt = now;
      }
      if (heading(document, "Picked for you", true)) w.__reveal.sawFeedSkeleton = true;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

test.describe("Home reveal order (#2254)", () => {
  test("HOME-REVEAL-01: signed-in feed lands in a reserved slot; Trending Now never moves", async ({
    authenticatedPage: page,
  }) => {
    await installRevealRecorder(page);
    await mockPopularity(page);
    await page.route("**/recommendations/*/home-feed", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, FEED_DELAY_MS));
      await route.fulfill({ json: feedBody });
    });

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Because you play Electronic" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Trending Now", level: 3 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Top Artists", level: 3 })).toBeVisible();
    // Let any late layout settle before reading the recording.
    await page.waitForTimeout(500);

    const reveal = await page.evaluate(
      () => (window as unknown as { __reveal: Record<string, unknown> }).__reveal,
    );
    expect(reveal.sawFeedSkeleton).toBe(true);
    // The real Trending Now section only ever painted after the feed slot did...
    expect(reveal.firstFeedAt).not.toBeNull();
    expect(reveal.firstTrendingAt).not.toBeNull();
    expect(reveal.firstTrendingAt as number).toBeGreaterThanOrEqual(reveal.firstFeedAt as number);
    // ...and from its first painted frame it sat at one fixed offset below the tuner.
    expect(reveal.gaps).toHaveLength(1);
  });

  test("HOME-REVEAL-02: a failed feed does not hold the page on skeletons", async ({
    authenticatedPage: page,
  }) => {
    await installRevealRecorder(page);
    await mockPopularity(page);
    await page.route("**/recommendations/*/home-feed", (route) =>
      route.fulfill({ status: 500, json: { message: "boom" } }),
    );

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Trending Now", level: 3 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Top Artists", level: 3 })).toBeVisible();
    await expect(page.locator("section.ng-shelf--skeleton h3", { hasText: "Picked for you" })).toHaveCount(0);
    await expect(page.locator("section.ng-shelf--skeleton h3", { hasText: "Trending Now" })).toHaveCount(0);
  });

  test("HOME-REVEAL-03: signed out never shows a feed skeleton", async ({ page }) => {
    await installRevealRecorder(page);
    await mockPopularity(page);

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Trending Now", level: 3 })).toBeVisible();
    await page.waitForTimeout(500);

    const reveal = await page.evaluate(
      () => (window as unknown as { __reveal: Record<string, unknown> }).__reveal,
    );
    expect(reveal.sawFeedSkeleton).toBe(false);
    expect(reveal.gaps).toHaveLength(1);
  });
});
