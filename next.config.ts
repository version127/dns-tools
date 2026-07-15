import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  output: "standalone",
  poweredByHeader: false,
  redirects: async () => [
    { source: "/dns-tools", destination: "/", permanent: true },
    { source: "/dns-tools/:tool", destination: "/:tool", permanent: true },
  ],
  turbopack: { root: process.cwd() },
};

export default nextConfig;
