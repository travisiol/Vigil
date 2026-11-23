import type { NextConfig } from "next";

const config: NextConfig = {
  turbopack: { root: process.cwd() },
  // La landing v2 est une page statique : / → public/landing.html
  async rewrites() {
    return { beforeFiles: [{ source: "/", destination: "/landing.html" }], afterFiles: [], fallback: [] };
  },
  images: { remotePatterns: [{ protocol: "https", hostname: "**" }] },
};

export default config;
