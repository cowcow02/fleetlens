import type { NextConfig } from "next";
import path from "node:path";

const config: NextConfig = {
  output: "standalone",
  // playwright must stay external — bundling it breaks browser discovery, and
  // the PDF route launches real Chromium at request time.
  serverExternalPackages: ["pg", "playwright", "playwright-core"],
  // Headless PDF capture navigates to 127.0.0.1 from the API route (see
  // internalRenderBaseUrl). Allow that host in dev so Turbopack HMR assets load.
  allowedDevOrigins: ["127.0.0.1"],
  reactStrictMode: true,
  transpilePackages: ["@claude-lens/parser"],
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
};
export default config;
