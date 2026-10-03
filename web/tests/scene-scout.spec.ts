import { test, expect } from "./auth.setup";
import { mockSceneScoutApi } from "./fixtures/scene-scout-mock.mjs";

test("city demand card opens an editable draft with the right release", async ({ authenticatedPage: page }) => {
  await mockSceneScoutApi(page);
  await page.goto("/artist/analytics");
  await expect(page.getByRole("heading", { name: "Consider a show in Paris" })).toBeVisible();
  await page.getByRole("link", { name: "Draft a show" }).click();
  await expect(page).toHaveURL(/\/shows\/create\?city=paris&country=FR&releaseId=guide-first-light/);
  await expect(page.getByText("Scene Scout suggested Paris for First Light.", { exact: false })).toBeVisible();
  await expect(page.getByLabel("City", { exact: true })).toHaveValue("Paris");
  await expect(page.getByLabel("Country", { exact: true })).toHaveValue("FR");
  await page.getByLabel("City", { exact: true }).fill("Lyon");
  await expect(page.getByLabel("City", { exact: true })).toHaveValue("Lyon");
});
