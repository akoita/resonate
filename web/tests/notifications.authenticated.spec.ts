"use strict";

import { test, expect } from "./auth.setup";

test.describe("Authenticated Notifications", () => {
    test("NOTIFY-AUTH-01: topbar bell is visible for authenticated users", async ({ authenticatedPage }) => {
        await authenticatedPage.goto("/player");

        await expect(
            authenticatedPage.getByRole("button", { name: "Notifications" }),
        ).toBeVisible();
    });

    test("NOTIFY-AUTH-02: notification preferences are reachable from settings", async ({ authenticatedPage }) => {
        await authenticatedPage.goto("/settings");

        const main = authenticatedPage.getByRole("main");
        await expect(main.getByText("Notifications", { exact: true })).toBeVisible();
        await expect(main.getByText("Notification Preferences", { exact: false })).toBeVisible();
    });
});
