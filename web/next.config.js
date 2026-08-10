/** @type {import('next').NextConfig} */
const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
const apiOrigin = new URL(apiUrl);
const apiBasePath = apiOrigin.pathname.replace(/\/+$/, "");
const localImageOptimizerHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
// Accommodate high-resolution square cover art while bounding Sharp decompression.
const MAX_RELEASE_ARTWORK_INPUT_PIXELS = 4096 * 4096;
const IMAGE_OPTIMIZER_MINIMUM_CACHE_TTL_DEFAULT = 0;
const IMAGE_OPTIMIZER_MINIMUM_CACHE_TTL_MIN = 0;
const IMAGE_OPTIMIZER_MINIMUM_CACHE_TTL_MAX = 86400;
const IMAGE_OPTIMIZER_SHARP_CONCURRENCY_DEFAULT = 1;
const IMAGE_OPTIMIZER_SHARP_CONCURRENCY_MIN = 1;
const IMAGE_OPTIMIZER_SHARP_CONCURRENCY_MAX = 4;

function parseIntegerEnv(rawValue, defaultValue, min, max) {
  if (typeof rawValue !== "string" || rawValue.trim() === "") {
    return defaultValue;
  }
  const value = Number(rawValue);
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    return defaultValue;
  }
  return Math.min(max, Math.max(min, value));
}

const imageOptimizerMinimumCacheTTL = parseIntegerEnv(
  process.env.IMAGE_OPTIMIZER_MINIMUM_CACHE_TTL,
  IMAGE_OPTIMIZER_MINIMUM_CACHE_TTL_DEFAULT,
  IMAGE_OPTIMIZER_MINIMUM_CACHE_TTL_MIN,
  IMAGE_OPTIMIZER_MINIMUM_CACHE_TTL_MAX,
);
const imageOptimizerSharpConcurrency = parseIntegerEnv(
  process.env.IMAGE_OPTIMIZER_SHARP_CONCURRENCY,
  IMAGE_OPTIMIZER_SHARP_CONCURRENCY_DEFAULT,
  IMAGE_OPTIMIZER_SHARP_CONCURRENCY_MIN,
  IMAGE_OPTIMIZER_SHARP_CONCURRENCY_MAX,
);

// Build-time identity exposed in the in-app About modal. Prefer the
// CI-provided SHA (GitHub Actions / Vercel) so container builds without
// git history still show a useful value; fall back to local git, then
// empty string. APP_VERSION is read from package.json so a single bump
// flows through.
function readCommitSha() {
  const fromEnv =
    process.env.NEXT_PUBLIC_COMMIT_SHA ||
    process.env.GITHUB_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.CI_COMMIT_SHA;
  if (fromEnv) return String(fromEnv).slice(0, 7);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- next.config.js is CJS
    const { execSync } = require("child_process");
    return execSync("git rev-parse --short HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "";
  }
}
// eslint-disable-next-line @typescript-eslint/no-require-imports -- next.config.js is CJS
const appVersion = require("./package.json").version || "";
const commitSha = readCommitSha();

const nextConfig = {
  output: "standalone",
  images: {
    remotePatterns: [
      {
        protocol: apiOrigin.protocol.slice(0, -1),
        hostname: apiOrigin.hostname,
        port: apiOrigin.port,
        pathname: `${apiBasePath}/catalog/releases/*/artwork`,
        search: "",
      },
      {
        protocol: apiOrigin.protocol.slice(0, -1),
        hostname: apiOrigin.hostname,
        port: apiOrigin.port,
        pathname: `${apiBasePath}/shows/campaigns/*/visuals/*`,
        search: "",
      },
    ],
    dangerouslyAllowLocalIP: localImageOptimizerHosts.has(apiOrigin.hostname),
    minimumCacheTTL: imageOptimizerMinimumCacheTTL,
    maximumRedirects: 0,
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
    NEXT_PUBLIC_COMMIT_SHA: commitSha,
  },
  experimental: {
    cssChunking: 'strict',  // Only load CSS for components actually rendered
    imgOptMaxInputPixels: MAX_RELEASE_ARTWORK_INPUT_PIXELS,
    imgOptConcurrency: imageOptimizerSharpConcurrency,
  },
  turbopack: {
    root: __dirname,
  },
  async rewrites() {
    return [
      // ZeroDev passkey proxy is handled by /api/zerodev/[...slug]/route.ts
      // which routes to either self-hosted (NestJS) or ZeroDev based on slug
      {
        source: "/api/bundler/:path*",
        destination: "http://localhost:4337/:path*",
      },
      {
        source: "/api/metadata/:path*",
        destination: `${apiUrl}/metadata/:path*`,
      },
      {
        source: "/api/encryption/:path*",
        destination: `${apiUrl}/encryption/:path*`,
      },
      {
        source: "/api/stem-pricing/:path*",
        destination: `${apiUrl}/api/stem-pricing/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
