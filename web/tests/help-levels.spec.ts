import { test, expect } from "@playwright/test";

/**
 * Remix Studio guide level switch (#1905): deep links, keyboard, the "Ready
 * for more?" hand-off, and search opening the level a match comes from.
 */
test.describe("Help article level switch (#1905)", () => {
  test("?level=pro deep link, arrow keys, and Ready for more?", async ({ page }) => {
    await page.goto("/help/remix-studio?level=pro");
    const tabs = page.getByRole("tablist", { name: "Choose your level" });
    const pro = tabs.getByRole("tab", { name: "Professional", exact: true });
    await expect(pro).toHaveAttribute("aria-selected", "true");
    const panel = page.getByRole("tabpanel", { name: "Professional" });
    await expect(panel.getByRole("heading", { name: "Signal chain" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your first remix, step by step" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Glossary" })).toBeVisible();

    // Arrow keys move and select, wrapping from the last tab to the first.
    await pro.focus();
    await page.keyboard.press("ArrowRight");
    const beginner = tabs.getByRole("tab", { name: "Beginner", exact: true });
    await expect(beginner).toHaveAttribute("aria-selected", "true");
    await expect(beginner).toBeFocused();
    await expect(page).toHaveURL(/\?level=beginner$/);
    await expect(page.getByRole("heading", { name: "Your first remix, step by step" })).toBeVisible();
    const overview = page.getByRole("img", { name: /numbered callouts/ });
    await expect(overview).toBeVisible();
    expect(await overview.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1440);

    // Ready for more? hands over to the next level.
    await page.getByRole("link", { name: /Continue with Intermediate/ }).click();
    const intermediate = tabs.getByRole("tab", { name: "Intermediate", exact: true });
    await expect(intermediate).toHaveAttribute("aria-selected", "true");
    await expect(intermediate).toBeFocused();
    await expect(page).toHaveURL(/\?level=intermediate$/);
    await expect(page.getByRole("heading", { name: "Effects on one part" })).toBeVisible();
  });

  test("search opens the level the match comes from", async ({ page }) => {
    await page.goto("/help");
    await page.getByRole("searchbox", { name: "Search the guide" }).fill("LUFS");
    const result = page.getByRole("link", { name: /Remix Studio/ });
    await expect(result).toHaveAttribute("href", "/help/remix-studio?level=pro");
    await result.click();
    await expect(
      page.getByRole("tab", { name: "Professional", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { name: "Render and preview: loudness" })).toBeVisible();
  });
});
