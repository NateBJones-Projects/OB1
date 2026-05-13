import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.0.140"],
  // Enables the .next/standalone output, which packages only the files needed
  // to run the dashboard. Required for clean multi-stage Docker builds
  // (~150 MB runtime image vs ~500 MB without). No-op on Vercel deploys —
  // Vercel uses its own bundling pipeline and ignores this setting.
  output: "standalone",
};

export default nextConfig;
