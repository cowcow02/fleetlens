import type { NextConfig } from "next";
import path from "node:path";

const config: NextConfig = {
  output: "standalone",
  // playwright must stay external — bundling it breaks browser discovery, and
  // the PDF route launches real Chromium at request time.
  serverExternalPackages: ["pg", "playwright", "playwright-core"],
  // NFT still under-traces playwright-core (omits browsers.json). The Dockerfile
  // overlays complete packages; this include is a belt-and-suspenders for local
  // standalone runs.
  outputFileTracingIncludes: {
    "/api/team/[slug]/insights/pdf": [
      "./node_modules/playwright/**/*",
      "./node_modules/playwright-core/**/*",
      "../../node_modules/playwright/**/*",
      "../../node_modules/playwright-core/**/*",
    ],
  },
  // Headless PDF capture navigates to 127.0.0.1 from the API route (see
  // internalRenderBaseUrl). Allow that host in dev so Turbopack HMR assets load.
  allowedDevOrigins: ["127.0.0.1"],
  reactStrictMode: true,
  transpilePackages: ["@claude-lens/parser"],
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
};
export default config;
