import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  async rewrites() {
    return [
      {
        source: "/api/zerodev/:path*",
        destination: "https://passkeys.zerodev.app/api/v2/:path*",
      },
    ];
  },
};

export default nextConfig;
