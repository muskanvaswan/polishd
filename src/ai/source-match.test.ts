/**
 * Tests for matching a loss's evidence to a source file.
 *
 * Run with `npm test`. The fixtures are trimmed copies of real markup — the
 * dashboard's drawer backdrop, its two "Show N more" toggles — because the
 * failure this guards against came from real markup: a backdrop cited as
 * `div.fixed>div.absolute` was "verified" against whichever file first said
 * `fixed`, and the fix prompt sent the reader there with a green tick.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isUtilityClass,
  knownNames,
  labelPattern,
  matchSource,
  routeFiles,
  routeSegments,
  sourceNeedles,
  stripComments,
  type KnownNames,
} from "./source-match.ts";

const NONE: KnownNames = { components: [], labels: [], paths: [] };

/** A tiny in-memory source tree. */
function tree(files: Record<string, string>) {
  return { files: Object.keys(files), read: (p: string) => files[p] ?? null };
}

const DRAWER = `export function Drawer({ open, onClose, children }) {
  return (
    <div className={\`fixed inset-0 z-50 \${open ? "" : "pointer-events-none"}\`} aria-hidden={!open}>
      {/* backdrop */}
      <div onClick={onClose} className="absolute inset-0 bg-black/60 transition-opacity" />
      <div className="absolute inset-x-0 bottom-0">{children}</div>
    </div>
  );
}`;

const FEATURES = `export function Features({ items }) {
  const hidden = items.length - 3;
  return (
    <div className="flex flex-col gap-2 text-white">
      <button data-component="features-more" onClick={toggle}>
        {expanded ? "Show less" : \`Show \${hidden} more\`}
      </button>
    </div>
  );
}`;

const ELEMENTS = `export function Elements({ rows }) {
  return (
    <div className="mb-8 flex">
      <button onClick={toggle}>{expanded ? "Show less" : \`Show \${hidden} more\`}</button>
    </div>
  );
}`;

const OVERFLOW = `export function OverflowRow({ label, fit }) {
  return <button>{open ? "Show less ↑" : \`Show \${fit.hidden} more \${label} ↓\`}</button>;
}`;

const ROOT = `export default function Root({ children }) {
  return <div className="polishd-root fixed inset-0 text-white">{children}</div>;
}`;

const REPO = tree({
  "src/dashboard/drawer.tsx": DRAWER,
  "src/dashboard/features.tsx": FEATURES,
  "src/dashboard/elements.tsx": ELEMENTS,
  "src/dashboard/overflow-row.tsx": OVERFLOW,
  "src/dashboard/root.tsx": ROOT,
});

// ── What becomes a needle ────────────────────────────────────────────────────

test("utility classes are not names an author chose", () => {
  for (const c of [
    "fixed", "absolute", "flex", "text-white", "mb-8", "bg-black/60", "inset-0", "min-h-screen",
    "max-w-7xl", "hover:bg-white", "md:flex", "-mt-2", "w-[320px]", "space-y-4", "line-clamp-2",
    "rounded-lg", "z-50", "btn-primary", "col-md-6", "d-flex", "transition-opacity",
  ]) {
    assert.equal(isUtilityClass(c), true, c);
  }
  for (const c of ["nav-drawer", "hero-cta", "polishd-root", "pricingCard"]) {
    assert.equal(isUtilityClass(c), false, c);
  }
});

test("a utility-only selector yields no needles at all", () => {
  assert.deepEqual(sourceNeedles("div.fixed>div.absolute", NONE), []);
  assert.deepEqual(sourceNeedles("div.flex>span.text-white", NONE), []);
  assert.deepEqual(sourceNeedles("`main.mb-8>section.relative>div`", NONE), []);
});

test("an ancestor's class only narrows; the clicked element's own class can decide", () => {
  const needles = sourceNeedles("div.polishd-root>div.fixed>div.absolute", NONE);
  assert.deepEqual(needles, [
    { kind: "identifier", value: "polishd-root", form: "literal", narrowOnly: true },
  ]);
  const own = sourceNeedles("div.flex>button.hero-cta", NONE);
  assert.deepEqual(own, [{ kind: "identifier", value: "hero-cta", form: "literal" }]);
});

test("framework-generated ids are skipped, authored ids kept", () => {
  assert.deepEqual(sourceNeedles("div#:r1:>button.px-3", NONE), []);
  assert.deepEqual(sourceNeedles("div#radix-12>button", NONE), []);
  assert.deepEqual(sourceNeedles("button#checkout-submit", NONE), [
    { kind: "identifier", value: "checkout-submit", form: "literal" },
  ]);
});

test("known component names and labels are recognized, quoted or not", () => {
  const known: KnownNames = {
    components: ["features-more"],
    labels: ["Show 9 more"],
    paths: ["/pricing"],
  };
  assert.deepEqual(sourceNeedles("features-more", known)[0], {
    kind: "component",
    value: "features-more",
  });
  assert.deepEqual(sourceNeedles('"Show 9 more"', known), [{ kind: "label", value: "Show 9 more" }]);
  assert.deepEqual(sourceNeedles("/pricing", known), [{ kind: "route", value: "/pricing" }]);
});

test("prose words and built-in error names are not identifiers", () => {
  const needles = sourceNeedles("TypeError: JavaScript failed", NONE);
  assert.equal(needles.some((n) => n.kind === "identifier"), false);
  assert.deepEqual(sourceNeedles("SignupForm", NONE), [
    { kind: "identifier", value: "SignupForm", form: "word" },
  ]);
});

test("knownNames gathers components, labels and paths from the data and profile", () => {
  const known = knownNames(
    {
      elements: [{ label: "div.flex", selector: "div.flex", sampleText: "Show 9 more" }],
      monitored: [{ name: "pricing-table" }],
      topUsed: [{ label: "hero-cta", isComponent: true }, { label: "a.px-3", isComponent: false }],
      pages: [{ path: "/" }],
      friction: {
        clicks: [{ key: "nav", by: "component", text: "Docs" }],
        pages: [{ path: "/blog" }],
        errors: [],
        capped: false,
      },
    } as never,
    { coveredIdentifiers: ["site-header"] },
  );
  assert.deepEqual(known.components.sort(), ["hero-cta", "nav", "pricing-table", "site-header"]);
  assert.deepEqual(known.labels.sort(), ["Docs", "Show 9 more"]);
  assert.deepEqual(known.paths.sort(), ["/", "/blog"]);
});

// ── Labels ───────────────────────────────────────────────────────────────────

test("a number in a label matches the expression that renders it", () => {
  const re = labelPattern("Show 9 more")!;
  assert.match("`Show ${hidden} more`", re);
  assert.match(">\n  Show {items.length - 3} more\n</button>", re);
  assert.match("'Show 9 more'", re);
  assert.doesNotMatch("Show more", re);
});

test("a whole label doesn't match a longer string that merely starts with it", () => {
  const whole = labelPattern("Show 9 more", true)!;
  assert.match("`Show ${hidden} more`", whole);
  assert.doesNotMatch("`Show ${fit.hidden} more ${label} ↓`", whole);
});

test("a one-word label only matches where it's written as text", () => {
  const re = labelPattern("Save")!;
  assert.match("<button>Save</button>", re);
  assert.match('{busy ? "Saving…" : "Save"}', re);
  assert.doesNotMatch("function saveDraft() { save(); }", re);
  assert.equal(labelPattern("OK"), null);
});

// ── Matching ─────────────────────────────────────────────────────────────────

test("a backdrop cited by its utility selector matches nothing — not the first file saying 'fixed'", () => {
  const needles = sourceNeedles("div.polishd-root>div.fixed>div.absolute", NONE);
  assert.deepEqual(matchSource(needles, REPO.files, REPO.read), {});
});

test("a label rendered by two components comes back as candidates, none picked", () => {
  const known: KnownNames = { components: [], labels: ["Show 9 more"], paths: [] };
  const m = matchSource(sourceNeedles("Show 9 more", known), REPO.files, REPO.read);
  assert.equal(m.location, undefined);
  assert.deepEqual(m.candidates, ["src/dashboard/elements.tsx", "src/dashboard/features.tsx"]);
});

test("a component name beats a label, and resolves to where it's defined", () => {
  const known: KnownNames = { components: ["features-more"], labels: [], paths: [] };
  const files = tree({
    "src/dashboard/features.tsx": FEATURES,
    "src/dashboard/docs.tsx": `// Wrap the toggle: data-component "features-more" is defined in features.tsx\nexport const id = "features-more";`,
  });
  const m = matchSource(sourceNeedles("features-more", known), files.files, files.read);
  assert.equal(m.location, "src/dashboard/features.tsx");
  assert.equal(m.needle?.kind, "component");
});

test("an ancestor class narrows an ambiguous label to the one file that has both", () => {
  const files = tree({
    "src/a.tsx": `<nav className="site-nav"><a>Get started</a></nav>`,
    "src/b.tsx": `<section className="hero"><a>Get started</a></section>`,
  });
  const known: KnownNames = { components: [], labels: ["Get started"], paths: [] };
  const ambiguous = matchSource(sourceNeedles("Get started", known), files.files, files.read);
  assert.deepEqual(ambiguous.candidates, ["src/a.tsx", "src/b.tsx"]);
  const needles = [
    ...sourceNeedles("Get started", known),
    ...sourceNeedles("nav.site-nav>a", NONE),
  ];
  assert.equal(matchSource(needles, files.files, files.read).location, "src/a.tsx");
});

test("a narrow-only needle never decides on its own", () => {
  const m = matchSource(
    [{ kind: "identifier", value: "polishd-root", form: "literal", narrowOnly: true }],
    REPO.files,
    REPO.read,
  );
  assert.deepEqual(m, {});
});

test("a PascalCase name used in several files resolves to the file named after it", () => {
  const files = tree({
    "app/page.tsx": `import { SignupForm } from "../components/SignupForm";\nexport default () => <SignupForm />;`,
    "app/join/page.tsx": `import { SignupForm } from "../../components/SignupForm";`,
    "components/SignupForm.tsx": `export function SignupForm() { return <form />; }`,
  });
  const m = matchSource(sourceNeedles("SignupForm", NONE), files.files, files.read);
  assert.equal(m.location, "components/SignupForm.tsx");
});

test("unreadable files (over a GitHub budget) are simply not matched", () => {
  const known: KnownNames = { components: [], labels: ["Show 9 more"], paths: [] };
  const m = matchSource(sourceNeedles("Show 9 more", known), REPO.files, (p) =>
    p.endsWith("features.tsx") ? FEATURES : null,
  );
  assert.equal(m.location, "src/dashboard/features.tsx");
});

// ── Routes ───────────────────────────────────────────────────────────────────

test("route files: groups and slots drop out, private and intercepting folders aren't routes", () => {
  assert.deepEqual(routeSegments("src/app/(marketing)/pricing/page.tsx"), ["pricing"]);
  assert.deepEqual(routeSegments("app/@modal/login/page.tsx"), ["login"]);
  assert.deepEqual(routeSegments("site/app/page.tsx"), []);
  assert.equal(routeSegments("app/_lib/page.tsx"), null);
  assert.equal(routeSegments("app/(.)photo/page.tsx"), null);
  assert.equal(routeSegments("app/pricing/layout.tsx"), null);
  assert.deepEqual(routeSegments("pages/blog/index.tsx"), ["blog"]);
  assert.deepEqual(routeSegments("src/pages/about.tsx"), ["about"]);
  assert.equal(routeSegments("pages/_app.tsx"), null);
  assert.equal(routeSegments("pages/api/hello.ts"), null);
});

test("a page path maps to its route file, static over dynamic over catch-all", () => {
  const files = [
    "app/page.tsx",
    "app/[[...slug]]/page.tsx",
    "app/blog/[slug]/page.tsx",
    "app/blog/new/page.tsx",
    "app/(shop)/pricing/page.tsx",
    "app/components/Hero.tsx",
  ];
  assert.deepEqual(routeFiles("/", files), ["app/page.tsx"]);
  assert.deepEqual(routeFiles("/blog/new", files), ["app/blog/new/page.tsx"]);
  assert.deepEqual(routeFiles("/blog/hello-world", files), ["app/blog/[slug]/page.tsx"]);
  assert.deepEqual(routeFiles("/pricing", files), ["app/(shop)/pricing/page.tsx"]);
  assert.deepEqual(routeFiles("/docs/a/b", files), ["app/[[...slug]]/page.tsx"]);
});

test("a cited page path is verified from the file listing alone — no contents needed", () => {
  const files = ["site/app/page.tsx", "site/app/pricing/page.tsx", "site/components/nav.tsx"];
  const m = matchSource(sourceNeedles("/pricing", NONE), files, () => null);
  assert.equal(m.location, "site/app/pricing/page.tsx");
});

test("labels and names quoted in comments don't count as the element", () => {
  const files = tree({
    "src/notes.tsx": `// the "Show 9 more" toggle lives in features.tsx\n/* also: Show 9 more */\nexport const url = "https://example.com/x"; // trailing`,
    "src/features.tsx": FEATURES,
  });
  const known: KnownNames = { components: [], labels: ["Show 9 more"], paths: [] };
  const m = matchSource(sourceNeedles("Show 9 more", known), files.files, files.read);
  assert.equal(m.location, "src/features.tsx");
  assert.equal(stripComments(files.read("src/notes.tsx")!).includes("https://example.com/x"), true);
});
