import { test, expect } from "@playwright/test";

test.describe("account abstraction flows", () => {
  test("session key issuance", async ({ request }) => {
    const login = await request.post("http://localhost:3000/auth/login", {
      data: { userId: "user-1", role: "admin" },
    });
    const token = (await login.json()).accessToken;
    const response = await request.post("http://localhost:3000/wallet/session-key", {
      data: { userId: "user-1", scope: "playback", ttlSeconds: 60 },
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.ok()).toBeTruthy();
  });

  test("deploy smart account", async ({ request }) => {
    const login = await request.post("http://localhost:3000/auth/login", {
      data: { userId: "user-2", role: "admin" },
    });
    const token = (await login.json()).accessToken;
    const response = await request.post("http://localhost:3000/wallet/deploy", {
      data: { userId: "user-2" },
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.ok()).toBeTruthy();
  });
});
