import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const PUBLIC_ROUTES = [
  { path: "/", surface: "Home" },
  { path: "/marketplace", surface: "Marketplace" },
  { path: "/shows/sennarin-paris", surface: "Shows campaign" },
] as const;

const AUTHENTICATED_ROUTES = [
  { path: "/library", surface: "Library" },
  { path: "/artist/upload", surface: "Artist upload" },
  { path: "/wallet", surface: "Wallet" },
  { path: "/player", surface: "Player" },
  { path: "/agent", surface: "AI DJ" },
] as const;

async function authenticate(page: Page) {
  const response = await page.request.post("http://localhost:3000/auth/login", {
    data: {
      userId: "e2e-user-00000000-0000-0000-0000-000000000001",
      role: "artist",
    },
  });
  expect(response.ok(), "E2E development login is available").toBe(true);
  const body = (await response.json()) as { accessToken: string };

  await page.addInitScript(({ token }) => {
    localStorage.setItem("resonate.token", token);
    localStorage.setItem("resonate.address", "0x1234567890abcdef1234567890abcdef12345678");
    sessionStorage.setItem("resonate.agent_onboarding_dismissed", "1");
  }, { token: body.accessToken });
}

async function openSettledRoute(page: Page, path: string) {
  const response = await page.goto(path, { waitUntil: "domcontentloaded" });
  expect(response?.ok(), `${path} loaded successfully`).toBe(true);
  await expect(page.locator("#main-content")).toBeVisible();
  await page.evaluate(async () => document.fonts.ready);
  await page.waitForTimeout(450);
}

async function assertNoBlockingViolations(page: Page, testInfo: TestInfo) {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  await testInfo.attach("axe-results", {
    body: JSON.stringify(results, null, 2),
    contentType: "application/json",
  });

  const blocking = results.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );
  const diagnostics = blocking.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.slice(0, 5).map((node) => ({
      target: node.target,
      html: node.html,
      failureSummary: node.failureSummary,
    })),
  }));

  expect(
    diagnostics,
    `Serious/critical WCAG A/AA violations:\n${JSON.stringify(diagnostics, null, 2)}`,
  ).toEqual([]);
}

test.describe("WCAG 2.2 AA automated baseline", () => {
  test.setTimeout(90_000);

  for (const route of PUBLIC_ROUTES) {
    test(`${route.surface} has no serious or critical automated violations`, async ({ page }, testInfo) => {
      await openSettledRoute(page, route.path);
      await assertNoBlockingViolations(page, testInfo);
    });
  }

  for (const route of AUTHENTICATED_ROUTES) {
    test(`${route.surface} has no serious or critical automated violations`, async ({ page }, testInfo) => {
      await authenticate(page);
      await openSettledRoute(page, route.path);
      await assertNoBlockingViolations(page, testInfo);
    });
  }
});

test.describe("keyboard accessibility smoke", () => {
  test("skip link moves focus to the main content", async ({ page }) => {
    await openSettledRoute(page, "/");
    await page.keyboard.press("Tab");
    const skipLink = page.getByRole("link", { name: "Skip to main content" });
    await expect(skipLink).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();
  });

  test("navigation exposes current-page and playlist-panel state", async ({ page }) => {
    await authenticate(page);
    await openSettledRoute(page, "/library");

    await expect(page.getByRole("link", { name: "Library", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );

    const toggle = page.getByRole("button", { name: "Open playlist panel" });
    await toggle.focus();
    await expect(toggle).toBeFocused();
    await toggle.press("Space");
    await expect(page.locator("button[aria-controls='global-playlist-panel']")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    const panel = page.locator("#global-playlist-panel");
    await expect(panel).toHaveAttribute("aria-hidden", "false");
    await expect(panel).not.toHaveAttribute("inert", "");

    const newPlaylist = panel.getByRole("button", { name: "New playlist" });
    await newPlaylist.click();
    const dialog = page.getByRole("dialog", { name: "New Playlist" });
    const input = dialog.getByRole("textbox", { name: "New Playlist" });
    await expect(input).toBeFocused();

    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", { name: "Confirm" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(input).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(newPlaylist).toBeFocused();
  });

  test("tabs and their panels support arrow-key navigation", async ({ page }) => {
    await openSettledRoute(page, "/artist/test-artist-id");

    const discography = page.getByRole("tab", { name: "Discography" });
    const community = page.getByRole("tab", { name: "Community" });
    await discography.focus();
    await discography.press("ArrowRight");

    await expect(community).toBeFocused();
    await expect(community).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel", { name: "Community" })).toBeVisible();
    await expect(page.locator("#discography-panel")).toBeHidden();
  });

  test("file drop target opens the native picker from the keyboard", async ({ page }) => {
    await authenticate(page);
    await openSettledRoute(page, "/import");

    const dropTarget = page.getByRole("button", { name: "Select audio files", exact: true });
    await dropTarget.focus();
    const chooserPromise = page.waitForEvent("filechooser");
    await dropTarget.press("Enter");
    const chooser = await chooserPromise;
    await chooser.setFiles([]);
    await expect(dropTarget).toBeFocused();
  });

  test("player controls expose names, state, and labelled sliders", async ({ page }) => {
    await authenticate(page);
    await openSettledRoute(page, "/player");
    const main = page.locator("#main-content");

    await expect(main.getByRole("button", { name: "Play", exact: true })).toBeVisible();
    await expect(main.getByRole("slider").first()).toHaveAccessibleName(/position|progress/i);
    await expect(main.getByRole("slider").last()).toHaveAccessibleName(/volume|gain/i);
  });
});
