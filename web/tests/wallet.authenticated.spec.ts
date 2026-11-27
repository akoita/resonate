import { expect, type Page, type Route } from "@playwright/test";
import { test } from "./auth.setup";

/*
 * Wallet newcomer pass: the Wallet page speaks in dollars with a "Test money"
 * badge, offers "Get my test money" when the welcome top-up has not arrived,
 * folds the technical side away, and the sidebar account card opens a menu
 * (Profile, Wallet, Settings, Sign out).
 *
 * The welcome-money API is answered here: a faucet sends real test-network
 * transfers, which the harness cannot do. The faucet's own rules (once per
 * account, daily limit, test networks only) are covered by the backend tests.
 */

const isBackend = (url: URL, pathname: string) => url.port === "3000" && url.pathname === pathname;

type Leg = "pending" | "sent" | "failed" | null;

function welcomeStatus(overrides: Partial<{ eth: Leg; usdc: Leg; canClaim: boolean }> = {}) {
  return {
    available: true,
    chainId: 84532,
    amountEth: "0.002",
    amountUsdc: "20",
    eth: null,
    usdc: null,
    canClaim: true,
    ...overrides,
  };
}

async function answerSurfaces(page: Page, wallet = true) {
  await page.route((url) => isBackend(url, "/config/surfaces"), (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        surfaces: {
          wallet,
          showsPledging: true,
          paidCollects: false,
          stemPurchases: false,
          agentPayments: false,
          disputes: false,
        },
      }),
    }),
  );
}

test.describe("Wallet for newcomers", () => {
  test("WALLET-01: plain balance, welcome card and claim of missing test money", async ({ authenticatedPage: page }) => {
    await answerSurfaces(page);
    let claimed = false;
    await page.route((url) => isBackend(url, "/welcome-funds"), async (route: Route) => {
      if (route.request().method() === "POST") {
        claimed = true;
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({
            result: { status: "sent", amountEth: "0.002", amountUsdc: "20" },
            welcome: welcomeStatus({ eth: "sent", usdc: "sent", canClaim: false }),
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(claimed ? welcomeStatus({ eth: "sent", usdc: "sent", canClaim: false }) : welcomeStatus()),
      });
    });

    await page.goto("/wallet");

    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { name: "Your balance" })).toBeVisible();
    await expect(main.getByTestId("wallet-dollar-balance")).toContainText("$");

    // No jargon on the first screen.
    const hero = main.locator(".vault-hero");
    await expect(hero).not.toContainText(/Smart Account|Kernel|ERC-4337|Gas/i);

    const card = main.getByTestId("wallet-welcome-card");
    await expect(card).toContainText("Every new account gets $20");
    await expect(card.getByRole("link", { name: "Browse shows" })).toHaveAttribute("href", "/shows");

    await card.getByTestId("wallet-claim-welcome").click();
    await expect(page.getByText("Your test money is on its way")).toBeVisible();
    await expect(card).toContainText("We added $20 to your wallet");
    await expect(card.getByTestId("wallet-claim-welcome")).toHaveCount(0);

    // The account's technical side is one click away, folded by default.
    const details = main.getByTestId("wallet-technical-details");
    await expect(details).not.toHaveAttribute("open", "");
    await details.locator("summary").click();
    await expect(details).toHaveAttribute("open", "");
  });

  test("WALLET-02: a daily-limit refusal is explained in plain words", async ({ authenticatedPage: page }) => {
    await answerSurfaces(page);
    await page.route((url) => isBackend(url, "/welcome-funds"), (route: Route) =>
      route.fulfill({
        status: route.request().method() === "POST" ? 201 : 200,
        contentType: "application/json",
        body: JSON.stringify(
          route.request().method() === "POST"
            ? { result: { status: "skipped", reason: "daily_limit" }, welcome: welcomeStatus() }
            : welcomeStatus(),
        ),
      }),
    );

    await page.goto("/wallet");
    const card = page.getByTestId("wallet-welcome-card");
    await card.getByTestId("wallet-claim-welcome").click();
    await expect(card.getByRole("status")).toHaveText(/all been handed out/);
  });

  test("WALLET-03: no welcome card where the deployment hands out no test money", async ({ authenticatedPage: page }) => {
    await answerSurfaces(page);
    await page.route((url) => isBackend(url, "/welcome-funds"), (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...welcomeStatus(), available: false, canClaim: false }),
      }),
    );

    await page.goto("/wallet");
    await expect(page.getByRole("heading", { name: "Your balance" })).toBeVisible();
    await expect(page.getByTestId("wallet-welcome-card")).toHaveCount(0);
  });

  test("WALLET-06: with fee money only, the welcome card points to free test dollars", async ({ authenticatedPage: page }) => {
    await answerSurfaces(page);
    await page.route((url) => isBackend(url, "/welcome-funds"), (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...welcomeStatus({ eth: "sent", canClaim: false }), amountUsdc: null }),
      }),
    );

    await page.goto("/wallet");
    const card = page.getByTestId("wallet-welcome-card");
    await expect(card).toContainText("We covered your fees");
    await expect(card).toContainText("Get free test dollars below");
    await expect(card).not.toContainText("$");
  });

  test("WALLET-04: the sidebar account card opens Profile, Wallet, Settings and Sign out", async ({ authenticatedPage: page }) => {
    await answerSurfaces(page);
    await page.goto("/player");

    const accountButton = page.getByTestId("sidebar-account-button");
    await expect(accountButton).toBeVisible();
    // Keyboard first: Enter opens the menu and focus moves to its first item.
    await accountButton.focus();
    await page.keyboard.press("Enter");

    const menu = page.getByRole("menu", { name: "Account" });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem")).toHaveText(["Profile", "Wallet", "Settings", "Sign out"]);
    await expect(accountButton).toHaveAttribute("aria-expanded", "true");
    await expect(menu.getByRole("menuitem", { name: "Profile" })).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(accountButton).toBeFocused();

    await page.keyboard.press("Enter");
    await page.getByRole("menuitem", { name: "Wallet" }).click();
    await expect(page).toHaveURL(/\/wallet$/);
  });

  test("WALLET-05: without the wallet switch the menu leaves Wallet out", async ({ authenticatedPage: page }) => {
    await answerSurfaces(page, false);
    await page.goto("/player");

    await page.getByTestId("sidebar-account-button").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menu", { name: "Account" }).getByRole("menuitem")).toHaveText([
      "Profile",
      "Settings",
      "Sign out",
    ]);
  });
});
