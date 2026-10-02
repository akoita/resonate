import { test, expect } from "@playwright/test";

// The AI DJ is no longer a standalone page (#2032): session control lives in
// the Home `#ai-dj` section and DJ preferences in Settings -> AI DJ.
test.describe("AI DJ (Home section + Settings)", () => {
    test("/agent redirects to the Home AI DJ section", async ({ page }) => {
        const response = await page.goto("/agent");
        expect(response).not.toBeNull();
        expect(response!.status()).toBeLessThan(500);
        await expect(page).toHaveURL(/\/#ai-dj$/);
        await expect(page.locator("#ai-dj")).toBeAttached();
    });

    test("Home renders the AI DJ section", async ({ page }) => {
        const response = await page.goto("/#ai-dj");
        expect(response).not.toBeNull();
        expect(response!.status()).toBeLessThan(500);
        const section = page.locator("#ai-dj");
        await expect(section).toBeAttached();
        await expect(section.getByRole("heading", { name: "Your AI DJ" })).toBeVisible({ timeout: 10000 });
    });

    test("signed out, the AI DJ section prompts for sign-in instead of session controls", async ({ page }) => {
        await page.goto("/");
        const section = page.locator("#ai-dj");
        await expect(section).toBeAttached();
        const signIn = section.getByRole("button", { name: "Sign in to start a session" });
        const panel = section.getByTestId("agent-session-panel");
        // Signed out: the sign-in prompt; signed in: the session panel.
        await expect(signIn.or(panel).first()).toBeVisible({ timeout: 10000 });
    });

    test("Set up your DJ opens the wizard when authenticated with no DJ", async ({ page }) => {
        await page.goto("/");
        const btn = page.locator("#ai-dj").getByRole("button", { name: "Set up your DJ" });
        if (await btn.isVisible({ timeout: 5000 }).catch(() => false)) {
            await btn.click();
            // Wizard step 1 should show the name input
            await expect(page.getByText("Name Your DJ")).toBeVisible();
        }
    });

    test("wizard allows completing all steps when authenticated", async ({ page }) => {
        await page.goto("/");
        const btn = page.locator("#ai-dj").getByRole("button", { name: "Set up your DJ" });
        if (await btn.isVisible({ timeout: 5000 }).catch(() => false)) {
            await btn.click();
            // Step 1: Name
            await expect(page.getByText("Name Your DJ")).toBeVisible();
            const nameInput = page.getByRole("textbox");
            await nameInput.fill("test-dj");
            await page.getByRole("button", { name: "Next" }).click();

            // Step 2: Vibe
            await expect(page.getByText("Choose Your Vibes")).toBeVisible();
        }
    });

    test("Settings deep link opens the AI DJ section", async ({ page }) => {
        const response = await page.goto("/settings?section=dj");
        expect(response).not.toBeNull();
        expect(response!.status()).toBeLessThan(500);
        // Without auth: the auth gate; with auth: the AI DJ preferences panel.
        const anyState = page.locator(".auth-panel, [data-testid='agent-dj-settings']");
        await expect(anyState.first()).toBeVisible({ timeout: 10000 });
    });
});
