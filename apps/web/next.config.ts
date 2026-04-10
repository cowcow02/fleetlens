import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // "standalone" is set via NEXT_OUTPUT env in CI (scripts/prepare-cli.mjs).
  // Locally, leave it unset so `next start` / `pnpm dev` work normally.
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" } : {}),
  reactStrictMode: true,
  transpilePackages: ["@claude-lens/parser"],
  // Tell Next.js the monorepo root so it doesn't infer the wrong one
  // from a stray lockfile higher up the directory tree.
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
};

export default nextConfig;
