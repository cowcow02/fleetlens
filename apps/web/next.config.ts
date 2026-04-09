import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // We read files under ~/.claude/projects at runtime; no special config needed.
  transpilePackages: ["@claude-sessions/parser"],
};

export default nextConfig;
