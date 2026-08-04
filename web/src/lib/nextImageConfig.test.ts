import { createRequire } from "node:module";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const configPath = path.resolve(process.cwd(), "next.config.js");
const originalApiUrl = process.env.NEXT_PUBLIC_API_URL;
const originalNodeEnv = process.env.NODE_ENV;

function loadConfig(apiUrl: string | undefined, nodeEnv: string) {
  if (apiUrl === undefined) {
    delete process.env.NEXT_PUBLIC_API_URL;
  } else {
    process.env.NEXT_PUBLIC_API_URL = apiUrl;
  }
  Reflect.set(process.env, "NODE_ENV", nodeEnv);
  delete require.cache[require.resolve(configPath)];
  return require(configPath) as {
    images: {
      remotePatterns: Array<{
        protocol: string;
        hostname: string;
        port: string;
        pathname: string;
        search: string;
      }>;
      dangerouslyAllowLocalIP: boolean;
      minimumCacheTTL: number;
      maximumRedirects: number;
    };
    experimental: {
      imgOptMaxInputPixels: number;
      imgOptConcurrency: number;
    };
  };
}

afterEach(() => {
  if (originalApiUrl === undefined) {
    delete process.env.NEXT_PUBLIC_API_URL;
  } else {
    process.env.NEXT_PUBLIC_API_URL = originalApiUrl;
  }
  if (originalNodeEnv === undefined) {
    Reflect.deleteProperty(process.env, "NODE_ENV");
  } else {
    Reflect.set(process.env, "NODE_ENV", originalNodeEnv);
  }
  delete require.cache[require.resolve(configPath)];
});

describe("Next image configuration", () => {
  it("allows only canonical artwork on the configured HTTPS API origin and base path", () => {
    const config = loadConfig("https://api.example.test:8443/platform/v1", "production");

    expect(config.images.remotePatterns).toEqual([
      {
        protocol: "https",
        hostname: "api.example.test",
        port: "8443",
        pathname: "/platform/v1/catalog/releases/*/artwork",
        search: "",
      },
    ]);
    expect(config.images.dangerouslyAllowLocalIP).toBe(false);
    expect(config.images.minimumCacheTTL).toBe(0);
    expect(config.images.maximumRedirects).toBe(0);
    expect(config.experimental.imgOptMaxInputPixels).toBe(4096 * 4096);
    expect(config.experimental.imgOptConcurrency).toBe(1);
  });

  it("supports the exact default loopback API in a production-mode local build", () => {
    const config = loadConfig(undefined, "production");

    expect(config.images.remotePatterns).toEqual([
      {
        protocol: "http",
        hostname: "localhost",
        port: "3000",
        pathname: "/catalog/releases/*/artwork",
        search: "",
      },
    ]);
    expect(config.images.dangerouslyAllowLocalIP).toBe(true);
    expect(config.images.minimumCacheTTL).toBe(0);
    expect(config.images.maximumRedirects).toBe(0);
    expect(config.experimental.imgOptMaxInputPixels).toBe(4096 * 4096);
    expect(config.experimental.imgOptConcurrency).toBe(1);
  });
});
