import path from "node:path";
import type { NextConfig } from "next";

// The capture core is shared with the package and imported from ../src, so
// both Turbopack and output tracing are rooted at the repository.
const repoRoot = path.join(import.meta.dirname, "..");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // `next dev` would otherwise write an AGENTS.md into this directory.
  agentRules: false,
  turbopack: { root: repoRoot },
  outputFileTracingRoot: repoRoot,
  // Loaded from node_modules at runtime rather than bundled: Chromium's
  // binary and Playwright's browser registry are files, not modules.
  serverExternalPackages: ["@sparticuz/chromium", "playwright-core", "allpages"],
  // Next's tracing can't see either of these — playwright-core reads its
  // registry with a computed path, and the Chromium binary is a brotli
  // archive unpacked at runtime — so they are named here. Keys match routes
  // as substrings.
  outputFileTracingIncludes: {
    "/api/v1/shoot": [
      "./node_modules/playwright-core/browsers.json",
      "./node_modules/@sparticuz/chromium/bin/**",
    ],
  },
};

export default nextConfig;
