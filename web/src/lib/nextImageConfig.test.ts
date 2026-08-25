import { createRequire } from "node:module";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const configPath = path.resolve(process.cwd(), "next.config.js");
const originalApiUrl = process.env.NEXT_PUBLIC_API_URL;
const originalNodeEnv = process.env.NODE_ENV;
const originalImageOptimizerMinimumCacheTTL =
  process.env.IMAGE_OPTIMIZER_MINIMUM_CACHE_TTL;
const originalImageOptimizerSharpConcurrency =
  process.env.IMAGE_OPTIMIZER_SHARP_CONCURRENCY;

type OptimizerEnv = {
  minimumCacheTTL?: string;
  sharpConcurrency?: string;
};

function loadConfig(
  apiUrl: string | undefined,
  nodeEnv: string,
  optimizerEnv: OptimizerEnv = {},
) {
  if (apiUrl === undefined) {
    delete process.env.NEXT_PUBLIC_API_URL;
  } else {
    process.env.NEXT_PUBLIC_API_URL = apiUrl;
  }
  if (optimizerEnv.minimumCacheTTL === undefined) {
    delete process.env.IMAGE_OPTIMIZER_MINIMUM_CACHE_TTL;
  } else {
    process.env.IMAGE_OPTIMIZER_MINIMUM_CACHE_TTL = optimizerEnv.minimumCacheTTL;
  }
  if (optimizerEnv.sharpConcurrency === undefined) {
    delete process.env.IMAGE_OPTIMIZER_SHARP_CONCURRENCY;
  } else {
    process.env.IMAGE_OPTIMIZER_SHARP_CONCURRENCY = optimizerEnv.sharpConcurrency;
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
  if (originalImageOptimizerMinimumCacheTTL === undefined) {
    delete process.env.IMAGE_OPTIMIZER_MINIMUM_CACHE_TTL;
  } else {
    process.env.IMAGE_OPTIMIZER_MINIMUM_CACHE_TTL =
      originalImageOptimizerMinimumCacheTTL;
  }
  if (originalImageOptimizerSharpConcurrency === undefined) {
    delete process.env.IMAGE_OPTIMIZER_SHARP_CONCURRENCY;
  } else {
    process.env.IMAGE_OPTIMIZER_SHARP_CONCURRENCY =
      originalImageOptimizerSharpConcurrency;
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
      {
        protocol: "https",
        hostname: "api.example.test",
        port: "8443",
        pathname: "/platform/v1/catalog/releases/*/artwork/v*",
        search: "",
      },
      {
        protocol: "https",
        hostname: "api.example.test",
        port: "8443",
        pathname: "/platform/v1/shows/campaigns/*/visuals/*",
        search: "",
      },
      {
        protocol: "https",
        hostname: "api.example.test",
        port: "8443",
        pathname: "/platform/v1/shows/campaigns/*/visuals/*/v*",
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
      {
        protocol: "http",
        hostname: "localhost",
        port: "3000",
        pathname: "/catalog/releases/*/artwork/v*",
        search: "",
      },
      {
        protocol: "http",
        hostname: "localhost",
        port: "3000",
        pathname: "/shows/campaigns/*/visuals/*",
        search: "",
      },
      {
        protocol: "http",
        hostname: "localhost",
        port: "3000",
        pathname: "/shows/campaigns/*/visuals/*/v*",
        search: "",
      },
    ]);
    expect(config.images.dangerouslyAllowLocalIP).toBe(true);
    expect(config.images.minimumCacheTTL).toBe(0);
    expect(config.images.maximumRedirects).toBe(0);
    expect(config.experimental.imgOptMaxInputPixels).toBe(4096 * 4096);
    expect(config.experimental.imgOptConcurrency).toBe(1);
  });

  it("accepts valid build-time optimizer overrides", () => {
    const config = loadConfig("https://api.example.test", "production", {
      minimumCacheTTL: "300",
      sharpConcurrency: "2",
    });

    expect(config.images.minimumCacheTTL).toBe(300);
    expect(config.experimental.imgOptConcurrency).toBe(2);
  });

  it("falls back to defaults for invalid, non-finite, and blank values", () => {
    for (const [minimumCacheTTL, sharpConcurrency] of [
      ["not-a-number", "2.5"],
      ["Infinity", "NaN"],
      ["", "  "],
    ]) {
      const config = loadConfig("https://api.example.test", "production", {
        minimumCacheTTL,
        sharpConcurrency,
      });

      expect(config.images.minimumCacheTTL).toBe(0);
      expect(config.experimental.imgOptConcurrency).toBe(1);
    }
  });

  it("clamps finite integer overrides to safe bounds", () => {
    const config = loadConfig("https://api.example.test", "production", {
      minimumCacheTTL: "999999",
      sharpConcurrency: "0",
    });

    expect(config.images.minimumCacheTTL).toBe(86400);
    expect(config.experimental.imgOptConcurrency).toBe(1);

    const secondConfig = loadConfig("https://api.example.test", "production", {
      minimumCacheTTL: "-1",
      sharpConcurrency: "999",
    });

    expect(secondConfig.images.minimumCacheTTL).toBe(0);
    expect(secondConfig.experimental.imgOptConcurrency).toBe(4);
  });
});
