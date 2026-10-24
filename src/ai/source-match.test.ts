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
  isShortLabel,
  labelMatches,
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
    } as never,
    { coveredIdentifiers: ["site-header"] },
    {
      clicks: [{ key: "nav", by: "component", text: "Docs" }],
      pages: [{ path: "/blog" }],
    } as never,
  );
  assert.deepEqual(known.components.sort(), ["hero-cta", "nav", "pricing-table", "site-header"]);
  assert.deepEqual(known.labels.sort(), ["Docs", "Show 9 more"]);
  assert.deepEqual(known.paths.sort(), ["/", "/blog"]);
});

// ── Labels ───────────────────────────────────────────────────────────────────

test("a number in a label — or the # capture folds it to — matches the expression that renders it", () => {
  for (const label of ["Show 9 more", "Show # more"]) {
    assert.equal(labelMatches(label, "`Show ${hidden} more`"), true, label);
    assert.equal(labelMatches(label, ">\n  Show {items.length - 3} more\n</button>"), true, label);
    assert.equal(labelMatches(label, "'Show 9 more'"), true, label);
    assert.equal(labelMatches(label, "Show more"), false, label);
  }
  assert.equal(labelMatches("#", "<b>{n}</b>"), false, "nothing but a number is no text");
});

test("a whole label doesn't match a longer string that merely starts with it", () => {
  assert.equal(labelMatches("Show 9 more", "`Show ${hidden} more`", true), true);
  assert.equal(labelMatches("Show 9 more", "`Show ${fit.hidden} more ${label} ↓`", true), false);
});

test("a one-word label only matches where it's written as text", () => {
  assert.equal(labelMatches("Save", "<button>Save</button>"), true);
  assert.equal(labelMatches("Save", '{busy ? "Saving…" : "Save"}'), true);
  assert.equal(labelMatches("Save", "function saveDraft() { save(); }"), false);
});

test("short labels match only as exact JSX text", () => {
  for (const label of ["Log in", "Buy now", "Pay", "OK"]) assert.equal(isShortLabel(label), true, label);
  for (const label of ["Export", "Sign up now", "Show # more"]) assert.equal(isShortLabel(label), false, label);
  assert.equal(labelMatches("Log in", "<button>\n  Log in\n</button>"), true);
  assert.equal(labelMatches("OK", "<Button onClick={close}>OK</Button>"), true);
  assert.equal(labelMatches("Log in", 'const cta = "Log in";'), false, "a string isn't rendered text");
  assert.equal(labelMatches("Pay", "<p>Pay later with Klarna</p>"), false, "part of longer text");
  assert.equal(labelMatches("OK", "if (res.ok) return <span>{ok}</span>"), false);
});

test("in a string, a label matches case-sensitively and never an id or class value", () => {
  assert.equal(labelMatches("Pricing", 'const tabs = ["Pricing", "Docs"]'), true);
  assert.equal(labelMatches("Pricing", '<section id="pricing">'), false);
  assert.equal(labelMatches("Pricing", '<section id="Pricing">'), false);
  assert.equal(labelMatches("Pricing", '<a className="Pricing">x</a>'), false);
  // Rendered text may be upper-cased by CSS, so JSX text still matches in any case.
  assert.equal(labelMatches("PRICING", "<a href=\"/pricing\">Pricing</a>"), true);
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

// ── Routes beat components; partial reads don't verify ───────────────────────

test("a cited path verifies to its route file, not a component sharing its name", () => {
  const files = tree({
    "app/pricing/page.tsx": `import { Pricing } from "../../components/Pricing";\nexport default () => <Pricing />;`,
    "components/Pricing.tsx": `export function Pricing() { return <section data-component="pricing">…</section>; }`,
  });
  const known: KnownNames = { components: ["pricing"], labels: [], paths: ["/pricing"] };
  const needles = sourceNeedles("/pricing", known);
  assert.deepEqual(needles, [
    { kind: "component", value: "pricing", narrowOnly: true },
    { kind: "route", value: "/pricing" },
  ]);
  const m = matchSource(needles, files.files, files.read);
  assert.equal(m.location, "app/pricing/page.tsx");
  assert.equal(m.needle?.kind, "route");
});

test("with part of the repo unread, a single content match is a candidate, not a verification", () => {
  const known: KnownNames = { components: ["features-more"], labels: ["Export"], paths: [] };
  for (const evidence of ["features-more", "Export", "button.export-btn", "SignupForm"]) {
    const files = tree({
      "app/page.tsx": `<button className="export-btn" data-component="features-more">Export</button>; <SignupForm />`,
    });
    const full = matchSource(sourceNeedles(evidence, known), files.files, files.read);
    assert.equal(full.location, "app/page.tsx", evidence);
    const partial = matchSource(sourceNeedles(evidence, known), files.files, files.read, { partial: true });
    assert.equal(partial.location, undefined, evidence);
    assert.deepEqual(partial.candidates, ["app/page.tsx"], evidence);
  }
  // A route is decided from the complete listing, so it still verifies.
  const routes = matchSource(sourceNeedles("/", NONE), ["app/page.tsx"], () => null, { partial: true });
  assert.equal(routes.location, "app/page.tsx");
});

// ── Selector shapes from current capture ─────────────────────────────────────

test("a data-component anchor in a selector or handle decides; an ancestor id only narrows", () => {
  assert.deepEqual(sourceNeedles('section[data-component="hero"]>div.flex>button.px-3', NONE), [
    { kind: "component", value: "hero" },
  ]);
  assert.deepEqual(sourceNeedles("div#settings>div.flex>button", NONE), [
    { kind: "identifier", value: "settings", form: "literal", narrowOnly: true },
  ]);
  const files = tree({
    "components/Hero.tsx": `<section data-component="hero"><button className="px-3">Go</button></section>`,
    "components/Other.tsx": `<div className="px-3" />`,
  });
  const m = matchSource(
    sourceNeedles("Show 9 more", NONE, { handle: 'section[data-component="hero"]>button.px-3' }),
    files.files,
    files.read,
  );
  assert.equal(m.location, "components/Hero.tsx");
});

test("variant prefixes, state classes and plugin utilities are not author names", () => {
  for (const c of [
    "tabular-nums", "transform-gpu", "no-scrollbar", "prose-lg", "prose-invert", "fade-in-0",
    "zoom-in-95", "slide-in-from-top-2", "animate-in", "peer-checked", "aria-expanded",
    "data-state", "group-hover", "is-active", "has-error", "focus-visible",
    "peer-checked:bg-white", "aria-expanded:rotate-180", "data-[state=open]:flex",
    "supports-[backdrop-filter]:bg-white/60", "group-hover/item:visible",
  ]) {
    assert.equal(isUtilityClass(c), true, c);
  }
  for (const c of ["filter-bar", "export-btn", "toggle-bar", "checkout-summary"]) {
    assert.equal(isUtilityClass(c), false, c);
  }
});
