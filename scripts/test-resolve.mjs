/**
 * Test-only module resolution: let `node --test` load source modules that
 * import their neighbours without an extension (`from "./store"`), the way
 * the bundler-resolved build does.
 *
 * Without it a test can only load an import-free module, which is why most
 * modules under test are written that way. With it, a test can import the
 * real server or capture code — the store against a throwaway SQLite file,
 * `initPolishd` against a stubbed browser — and exercise the wiring itself.
 *
 * Only a relative specifier with no extension that fails to resolve is
 * retried, as `.ts`, `.tsx`, then `/index.ts`. A package subpath with no
 * extension (`next/server`, from a package with no exports map) is retried
 * as `.js`, which is what lets a test load the route handler. Everything else
 * resolves as Node would. Passed to `node --test` with `--import` in
 * package.json.
 */
import { register } from "node:module";

const hooks = `
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    if (/\\.[cm]?[jt]sx?$/.test(specifier)) throw err;
    const relative = /^\\.\\.?\\//.test(specifier);
    if (!relative && !/^(@[^/]+\\/)?[^/.@][^/]*\\/./.test(specifier)) throw err;
    for (const suffix of relative ? [".ts", ".tsx", "/index.ts"] : [".js"]) {
      try {
        return await next(specifier + suffix, context);
      } catch {}
    }
    throw err;
  }
}
`;

register(`data:text/javascript,${encodeURIComponent(hooks)}`);
