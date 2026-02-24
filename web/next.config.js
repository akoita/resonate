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
      {
        source: "/api/zerodev/:path*",
        destination: "https://passkeys.zerodev.app/api/v2/:path*",
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
