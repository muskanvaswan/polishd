#!/usr/bin/env node
/**
 * Compile the dashboard's stylesheet and scope it to `.polishd-root`.
 *
 * Runs at publish time so consumers get `@polishd/next/dashboard.css` as a
 * finished artifact — no Tailwind required in the host app, no `@source` step
 * to forget, and no dependence on the host's compiler version.
 *
 * Scoping is the part that has to be done carefully. Tailwind v4 output is not
 * a flat list of rules: it carries `@property` registrations, `@keyframes`,
 * `:root` custom-property blocks, cascade layers and `@supports` guards, and a
 * naive string prefix mangles all of them. So the transform runs through a real
 * CSS parser and skips exactly the constructs that must stay at the top level.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import postcss from "postcss";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "src", "dashboard", "dashboard.css");
const OUT = join(root, "dist", "dashboard.css");
const SCOPE_CLASS = ".polishd-root";

/**
 * The scope is written twice on purpose.
 *
 * Scoping stops our rules reaching the host's markup, but it does nothing about
 * the reverse: a host rule whose selector happens to match our elements. Tailwind
 * class names live in a global namespace, so a host that isn't using Tailwind but
 * has its own `.flex`, `.hidden`, `.container` or `.grid` will style the
 * dashboard's markup — and at equal specificity the later stylesheet wins, which
 * is whichever one the bundler happened to emit last.
 *
 * Repeating the class costs a few bytes per selector and takes every rule here
 * to (0,2,0) or better, so the dashboard wins those ties by construction rather
 * than by load order. Relative precedence inside this file is unchanged, since
 * every selector is bumped equally.
 *
 * `:not(#polishd)` goes further. Negating an ID that never exists is always
 * true and counts as an ID in specificity, which lifts every rule above
 * anything a host writes with classes, attributes and elements — however long
 * the chain (`.app .main .card div`) — and above a rule that keys off a single
 * ID of its own (`#app div`) unless it also adds classes. What remains able to
 * beat the dashboard is `!important` and inline `style=""`, which no
 * stylesheet can outrank without shouting back.
 */
const SCOPE = `${SCOPE_CLASS}${SCOPE_CLASS}:not(#polishd)`;

/**
 * Selectors that hold theme custom properties rather than styling anything.
 *
 * These are widened rather than scoped. If `:root` became `.polishd-root :root`
 * — a selector matching nothing — every colour, spacing and font utility would
 * resolve to an empty value and the dashboard would render shapeless.
 *
 * Note that `*` is deliberately *not* here. Tailwind's `@property` fallback
 * block registers `--tw-*` defaults on `*`, and leaving that unscoped would set
 * them on every element in the host page — inert, but exactly the global reach
 * this file exists to avoid. `.polishd-root` is a bare wrapper that carries no
 * utilities of its own, so scoping `*` to its descendants loses nothing.
 */
const THEME_HOLDERS = /^(:root|html|:host)$/;

/** At-rules whose children are not style rules and must be left alone. */
const OPAQUE_AT_RULES = new Set(["keyframes", "-webkit-keyframes", "property", "font-face"]);

function scopeSelector(selector) {
  const trimmed = selector.trim();
  if (!trimmed) return trimmed;

  // Theme variables stay where they are, but the scope root also needs to
  // receive them, so these are widened rather than replaced.
  if (THEME_HOLDERS.test(trimmed)) {
    return trimmed === ":host" ? trimmed : `${trimmed}, ${SCOPE_CLASS}`;
  }

  // The hand-authored reset is written against the single class; rewrite its
  // leading scope so it gets the same specificity bump as everything else.
  // `.polishd-root[data-theme="light"]` is the root too, not a descendant of it.
  if (trimmed === SCOPE_CLASS || trimmed.startsWith(`${SCOPE_CLASS} `) ||
      trimmed.startsWith(`${SCOPE_CLASS}:`) || trimmed.startsWith(`${SCOPE_CLASS}[`)) {
    return SCOPE + trimmed.slice(SCOPE_CLASS.length);
  }

  // Everything else becomes a descendant. `.polishd-root` carries no utilities
  // itself, so descendant scoping is complete — see the note on THEME_HOLDERS.
  return `${SCOPE} ${trimmed}`;
}

const scopePlugin = {
  postcssPlugin: "polishd-scope",
  Once(css) {
    css.walkRules((rule) => {
      // Rules inside @keyframes are percentages/from/to, not selectors.
      for (let p = rule.parent; p; p = p.parent) {
        if (p.type === "atrule" && OPAQUE_AT_RULES.has(p.name.toLowerCase())) return;
      }
      rule.selectors = rule.selectors.map(scopeSelector);
    });
  },
};

/**
 * Flatten Tailwind's cascade layers.
 *
 * This is not cosmetic. **Unlayered CSS beats layered CSS outright**, whatever
 * the specificity — so a host with a plain `h1 { color: orange }` overrides a
 * `text-white` utility sitting in `@layer utilities`, and the dashboard renders
 * with the host app's typography bleeding through. That is the same class of
 * bug as the host's preflight leaking in, just arriving from the other
 * direction, and scoping alone does not prevent it.
 *
 * Unlayering our own rules puts them back under ordinary specificity, where
 * `.polishd-root .text-white` (0,2,0) comfortably beats `h1` (0,0,1). Layer
 * *order* is preserved as source order — theme, then base, then utilities —
 * which is what the layers encoded in the first place.
 *
 * What this still cannot beat is a host `!important` rule aimed at the same
 * property. Nothing short of `!important` on our side would, and a package
 * shouting over its host is worse than the occasional collision.
 */
const flattenLayersPlugin = {
  postcssPlugin: "polishd-flatten-layers",
  Once(css) {
    css.walkAtRules("layer", (at) => {
      // `@layer theme, base, utilities;` — an ordering statement with no body.
      if (!at.nodes) {
        at.remove();
        return;
      }
      at.replaceWith(at.nodes);
    });
  },
};

/**
 * Locate the Tailwind CLI without assuming a directory layout.
 *
 * A hardcoded `node_modules/@tailwindcss/cli/dist/index.mjs` only holds for a
 * flat npm install — pnpm and Yarn put it elsewhere — and when it is simply not
 * installed it fails with a bare MODULE_NOT_FOUND that says nothing about what
 * to do. Since this runs from `prepublishOnly`, that stack trace is the last
 * thing between someone and a release.
 *
 * The package exports only its own package.json, so its `bin` entry is the
 * supported way in.
 */
function resolveTailwindCli() {
  const require = createRequire(join(root, "package.json"));
  let pkgPath;
  try {
    pkgPath = require.resolve("@tailwindcss/cli/package.json");
  } catch {
    console.error(
      "\n✗ Cannot find @tailwindcss/cli, which builds the dashboard stylesheet.\n" +
        "  It is a devDependency, so this usually means dependencies are stale:\n\n" +
        "      npm install\n\n" +
        "  Then retry. (If you are publishing, `npm publish` runs this build via\n" +
        "  prepublishOnly, so install first.)\n",
    );
    process.exit(1);
  }
  const { bin } = JSON.parse(readFileSync(pkgPath, "utf8"));
  const rel = typeof bin === "string" ? bin : Object.values(bin ?? {})[0];
  if (!rel) {
    console.error("\n✗ @tailwindcss/cli is installed but exposes no bin entry.\n");
    process.exit(1);
  }
  return join(dirname(pkgPath), rel);
}

mkdirSync(dirname(OUT), { recursive: true });

// 1. Compile with the Tailwind CLI. `--optimize` minifies and drops unused
//    theme variables; without it the theme block alone is ~30KB of unused
//    custom properties.
const cli = resolveTailwindCli();
console.log("• compiling dashboard.css");
execFileSync(process.execPath, [cli, "--input", SRC, "--output", OUT, "--optimize"], {
  stdio: ["ignore", "inherit", "inherit"],
  cwd: root,
});

// 2. Scope every rule to the dashboard's subtree.
console.log(`• scoping to ${SCOPE_CLASS} and flattening cascade layers`);
const compiled = readFileSync(OUT, "utf8");
const scoped = postcss([scopePlugin, flattenLayersPlugin]).process(compiled, { from: OUT, to: OUT }).css;

const banner =
  `/*! @polishd/next dashboard styles — generated, do not edit.\n` +
  ` * Scoped to ${SCOPE_CLASS}; contains no global preflight. */\n`;
writeFileSync(OUT, banner + scoped);

// 3. Ship the brand fonts the stylesheet's @font-face rules point at. The URLs
//    are relative (`./fonts/…`), so they resolve beside dist/dashboard.css
//    exactly as they do beside the source file, and the host's bundler picks
//    the files up from there.
cpSync(join(root, "src", "dashboard", "fonts"), join(dirname(OUT), "fonts"), { recursive: true });
console.log("• copied dashboard fonts to dist/fonts");

// 4. Make the dashboard load its own stylesheet.
//
//    The page-level `import "@polishd/next/dashboard.css"` is one line, and
//    one line is easy to lose — skip it in a manual install, keep a 0.1.x page
//    that predates it — and the result is the worst kind of failure: the page
//    renders, the host's own Tailwind (if it scans the package) half-styles it
//    with the *host's* palette, and nothing errors. Harsh default borders, no
//    greys, the brand gone. So the compiled entry imports the stylesheet
//    itself, and the dashboard can't render without its own palette.
//
//    Done here rather than in src/dashboard/index.tsx because the relative
//    path only exists in dist/: the compiled stylesheet sits at
//    dist/dashboard.css, one level above dist/dashboard/index.js, while src/
//    holds only the uncompiled Tailwind source. `sideEffects` in package.json
//    lists CSS so a bundler can't tree-shake the import away. A page that also
//    imports it explicitly is fine: bundlers include a stylesheet once.
const ENTRY = join(root, "dist", "dashboard", "index.js");
const STYLE_IMPORT = `import "../dashboard.css";\n`;
if (existsSync(ENTRY)) {
  const entry = readFileSync(ENTRY, "utf8");
  if (!entry.startsWith(STYLE_IMPORT)) writeFileSync(ENTRY, STYLE_IMPORT + entry);
  console.log("• dist/dashboard/index.js imports its stylesheet");
}

const kb = (s) => `${(Buffer.byteLength(s) / 1024).toFixed(1)}KB`;
console.log(`✔ dist/dashboard.css  ${kb(compiled)} → ${kb(scoped)} scoped`);
