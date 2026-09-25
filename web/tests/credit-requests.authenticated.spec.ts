import type { Page } from "@playwright/test";
import { test, expect } from "@playwright/test";

/**
 * Operator credit-request queue (#1885) against a mocked credits API: the
 * pending list, the self-request lock, and a confirmed quick grant.
 */

const OPERATOR_ID = "0x1111111111111111111111111111111111111111";
const REQUESTER_ID = "0xa5369569fd24b019923bae45db8f9c0e6bf482cb";

function base64Url(value: object): string {
  return Buffer.from(JSON.stringify(value))
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

/** Unsigned mock JWT: the UI only decodes `sub` and `role`. */
const OPERATOR_TOKEN = [
  base64Url({ alg: "HS256", typ: "JWT" }),
  base64Url({ sub: OPERATOR_ID, role: "operator", iat: 1700000000, exp: 1800000000 }),
  "mock-signature",
].join(".");

async function signInAsOperator(page: Page) {
  await page.addInitScript(
    ({ token, address }) => {
      localStorage.setItem("resonate.token", token);
      localStorage.setItem("resonate.address", address);
      localStorage.setItem("resonate.mock_auth", "true");
    },
    { token: OPERATOR_TOKEN, address: OPERATOR_ID },
  );
}

function request(overrides: Record<string, unknown>) {
  return {
    id: "req-other",
    userId: REQUESTER_ID,
    note: "Out of credits mid-remix, could I get a top-up?",
    status: "pending",
    requestedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    resolvedAt: null,
    resolvedBy: null,
    grantedCents: null,
    resolutionNote: null,
    balanceCents: 0,
    ...overrides,
  };
}

test("operator reviews and grants a credit request (#1885)", async ({ page }) => {
  await signInAsOperator(page);
  let pending = [
    request({}),
    request({ id: "req-self", userId: OPERATOR_ID, note: "Testing my own request" }),
  ];
  const grants: Array<{ id: string; body: unknown }> = [];

  await page.route("**/credits/requests?**", (route) =>
    route.fulfill({ json: route.request().url().includes("status=resolved") ? [] : pending }),
  );
  await page.route("**/credits/requests/*/grant", async (route) => {
    const id = route.request().url().split("/credits/requests/")[1]!.split("/")[0]!;
    grants.push({ id, body: route.request().postDataJSON() });
    const granted = pending.find((entry) => entry.id === id)!;
    pending = pending.filter((entry) => entry.id !== id);
    await route.fulfill({
      status: 201,
      json: {
        ...granted,
        status: "granted",
        grantedCents: 500,
        resolvedAt: new Date().toISOString(),
        resolvedBy: OPERATOR_ID,
        resolutionNote: "Credit request top-up",
        balanceCents: 500,
      },
    });
  });
  await page.route("**/credits/balance", (route) =>
    route.fulfill({ json: { balanceCents: 100, priceCentsPer30s: 10, recentTransactions: [] } }),
  );

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/admin/credit-requests");

  await expect(page.getByText("Out of credits mid-remix, could I get a top-up?")).toBeVisible();
  // The operator's own request is honestly locked, never actionable.
  await expect(
    page.getByText("This is your own request — another operator has to resolve it."),
  ).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("credit-requests.png"), fullPage: true });

  // Quick-grant $5 on the other user's request → confirm → granted.
  await page
    .getByRole("group", { name: /Quick grant amounts for 0xa536/ })
    .getByRole("button", { name: "Grant $5.00" })
    .click();
  await expect(page.getByText(/Grant \$5\.00 of generation credits to 0xa536/)).toBeVisible();
  await page.getByRole("button", { name: /^Grant/ }).last().click();

  await expect.poll(() => grants.length).toBe(1);
  expect(grants[0]).toMatchObject({ id: "req-other", body: { amountCents: 500 } });
  await expect(page.getByText("Out of credits mid-remix, could I get a top-up?")).toHaveCount(0);
});
