import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    tsconfigPath: "tsconfig.web.json",
  },
  outputFileTracingIncludes: {
    "/api/extension/download": ["./extension/**/*"],
  },
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
