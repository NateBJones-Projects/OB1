import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.0.140"],
  output: process.env.VERCEL ? undefined : "standalone",
};

export default nextConfig;
