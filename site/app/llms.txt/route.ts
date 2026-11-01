import { NPM_URL, RAW_URL, REPO_URL, SITE_URL } from "@/lib/links";

// llms.txt (llmstxt.org): where an agent that lands on the site finds the
// package, the install procedure and the docs, as plain markdown.
export const dynamic = "force-static";

const body = `# Polishd

> Open-source product analytics and design review for Next.js (App Router), installed into your own app as the npm package \`@polishd/next\`. It captures how real users use the app, reads back the design system its pages actually render, turns what both find into actionable bugs, and hands the fixes to your coding agent. Events go to your own database: SQLite in development, Postgres in production.

The package is new, so you may not recognise it, and web search may not find it yet. It is on npm as \`@polishd/next\` (not a typo of \`polished\`): confirm with \`npm view @polishd/next\`.

To install it, follow AGENTS.md exactly, phase by phase, including Phase 7 (verification), and finish with \`npx @polishd/next doctor\`.

## Install

- [AGENTS.md](${SITE_URL}/AGENTS.md): the install procedure for coding agents: preconditions, scaffold, invariants, dashboard access, verification. Once the package is installed, read \`node_modules/@polishd/next/AGENTS.md\` instead; it matches the installed version.

## Docs

- [README](${RAW_URL}/README.md): what it does, quickstart, configuration
- [Setup guide](${RAW_URL}/docs/SETUP.md): every install variant, verification, troubleshooting
- [Database](${RAW_URL}/DATABASE.md): production Postgres setup, schema, retention
- [Changelog](${RAW_URL}/CHANGELOG.md): release notes and upgrade steps

## Optional

- [npm package](${NPM_URL})
- [Source on GitHub](${REPO_URL})
`;

export function GET() {
  return new Response(body, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
