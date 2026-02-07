/** @type {import('next').NextConfig} */
const nextConfig = {
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
        destination: "http://localhost:3000/metadata/:path*",
      },
      {
        source: "/api/encryption/:path*",
        destination: "http://localhost:3000/encryption/:path*",
      },
    ];
  },
};

module.exports = nextConfig;
