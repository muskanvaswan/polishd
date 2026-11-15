// The production origin. Canonical URLs, the sitemap and the social cards
// resolve against it, so the other domains serving the same deployment
// (polishd.muskanvaswan.xyz, polishd-lac.vercel.app) never compete in search.
export const SITE_URL = "https://polishd.site";

// The live demo: demo/ in this repo, deployed as its own project. Override at
// build time (NEXT_PUBLIC_DEMO_URL=http://localhost:3300) to point the page at
// a local copy.
export const DEMO_URL = process.env.NEXT_PUBLIC_DEMO_URL || "https://demo.polishd.site";

export const NPM_URL = "https://www.npmjs.com/package/@polishd/next";
export const REPO_URL = "https://github.com/muskanvaswan/polishd";
export const DOCS_URL = "https://github.com/muskanvaswan/polishd#readme";
// The repo's files as plain text, which is what an agent wants to read.
export const RAW_URL = "https://raw.githubusercontent.com/muskanvaswan/polishd/main";
