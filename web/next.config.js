/** @type {import('next').NextConfig} */
const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

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
const appVersion = require("./package.json").version || "";
const commitSha = readCommitSha();

const nextConfig = {
  output: "standalone",
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
    NEXT_PUBLIC_COMMIT_SHA: commitSha,
  },
  experimental: {
    cssChunking: 'strict',  // Only load CSS for components actually rendered
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
