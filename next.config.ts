import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the existing Cloudflare build as the default. The Baota build helper
  // sets VINEXT_DEPLOY_TARGET=node and asks vinext for a self-contained Node
  // server under dist/standalone.
  output: process.env.VINEXT_DEPLOY_TARGET === "node" ? "standalone" : undefined,
};

export default nextConfig;
