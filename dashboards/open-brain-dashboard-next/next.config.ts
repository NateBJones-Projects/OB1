import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.0.140"],
  output: "standalone",
};

export default nextConfig;
