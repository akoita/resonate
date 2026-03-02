/** @type {import('next').NextConfig} */
const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

const nextConfig = {
  output: "standalone",
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
