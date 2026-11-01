import { SITE_URL } from "@/lib/links";

// The prompt to paste into a coding agent. Keep it in step with the copies in
// the root README.md, docs/SETUP.md and the CLI help (bin/polishd.mjs). It
// says the package is new and to ask npm rather than search: a search that
// finds nothing is where agents give up, or decide it's a typo of `polished`.
export const AGENT_PROMPT = [
  "Install @polishd/next into this Next.js app.",
  "It's a new package, so you may not recognise it and a web search may not find it yet. " +
    "It is on npm (not a typo of `polished`): confirm with `npm view @polishd/next`, then install it.",
  `Follow its install procedure exactly: ${SITE_URL}/AGENTS.md\n` +
    "Once it's installed, read node_modules/@polishd/next/AGENTS.md instead; it matches the installed version.",
  "Work through its phases in order and do not skip Phase 7 (verification). Several of its constraints " +
    "fail silently at runtime rather than at build time, so a passing build does not mean the install worked.",
  "Finish by running `npx @polishd/next doctor` and fixing everything it reports.",
].join("\n\n");
