import { readFile } from "node:fs/promises";
import path from "node:path";
import { RAW_URL } from "@/lib/links";

// The install procedure, for agents asked to install a package they don't
// know yet: npmjs.com answers them with a 403, and search may not find it.
// Read at build time from the repo's own AGENTS.md, so it can't drift.
export const dynamic = "force-static";

export async function GET() {
  const body = (await procedure())
    // Its links are relative to the repo root, which this site isn't.
    .replace(/\]\(\.\/([^)]+)\)/g, `](${RAW_URL}/$1)`);
  return new Response(body, {
    headers: { "content-type": "text/markdown; charset=utf-8" },
  });
}

async function procedure(): Promise<string> {
  try {
    return await readFile(path.join(process.cwd(), "..", "AGENTS.md"), "utf8");
  } catch {
    // A host that builds only the site/ directory has no repo root to read
    // from; take main's copy instead of failing the deploy.
    const res = await fetch(`${RAW_URL}/AGENTS.md`);
    if (!res.ok) throw new Error(`AGENTS.md: ${res.status} from GitHub`);
    return res.text();
  }
}
