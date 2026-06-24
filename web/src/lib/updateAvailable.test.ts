import { describe, expect, it } from "vitest";
import { isUpdateAvailable } from "./updateAvailable";
import { BUILD_VERSION } from "./buildVersion";
import { GET } from "../app/api/version/route";

describe("isUpdateAvailable", () => {
  it("is false while running the unbuilt dev placeholder", () => {
    expect(isUpdateAvailable("dev", "abc123")).toBe(false);
    expect(isUpdateAvailable("dev", null)).toBe(false);
  });

  it("is false before the deployed version is known", () => {
    expect(isUpdateAvailable("abc123", null)).toBe(false);
  });

  it("is false when the deployed version matches the running build", () => {
    expect(isUpdateAvailable("abc123", "abc123")).toBe(false);
  });

  it("is false when the server reports the dev placeholder", () => {
    expect(isUpdateAvailable("abc123", "dev")).toBe(false);
  });

  it("is true when a different version is deployed", () => {
    expect(isUpdateAvailable("abc123", "def456")).toBe(true);
  });
});

describe("/api/version route", () => {
  it("returns the running build version and is never cached", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const body = (await res.json()) as { version: string };
    expect(body.version).toBe(BUILD_VERSION);
  });
});
