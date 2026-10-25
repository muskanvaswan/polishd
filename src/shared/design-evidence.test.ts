import assert from "node:assert/strict";
import { test } from "node:test";

import type { PolishdDesignData } from "../server/design";
import {
  citedDesignRefs,
  designUsagesFor,
  previewFor,
  publicImageUrl,
  usageFacts,
  whereItRendersMarkdown,
  type PreviewSource,
} from "./design-evidence.ts";

function data(overrides: Partial<PolishdDesignData> = {}): PolishdDesignData {
  return {
    ready: true,
    pages: [],
    families: [],
    contrast: [],
    flags: [],
    fonts: [
      { family: "Inter", sizePx: 16, weight: 400, count: 900, sample: null, tags: ["p"], pages: ["/", "/pricing"], outlier: false, declarations: 12 },
      { family: "Inter", sizePx: 17, weight: 500, count: 4, sample: null, tags: ["h3"], pages: ["/pricing"], outlier: true, declarations: 1, handTyped: 1 },
      { family: "Inter", sizePx: 13, weight: 400, count: 40, sample: null, tags: ["span"], pages: ["/", "/pricing"], outlier: false, declarations: 3 },
    ],
    colors: [
      { hex: "#0a0a0a", count: 412, roles: { text: 0, background: 400, border: 12 }, pages: ["/", "/pricing", "/about", "/blog"], pct: 61, outlier: false, declarations: 9 },
      { hex: "#888888", count: 30, roles: { text: 30, background: 0, border: 0 }, pages: ["/blog"], pct: 2, outlier: false, declarations: 2 },
      { hex: "#fafafa", count: 12, roles: { text: 0, background: 12, border: 0 }, pages: ["/pricing"], pct: 1, outlier: true, declarations: 1, handTyped: 1 },
    ],
    radii: [
      { value: "8px", count: 60, pages: ["/", "/pricing"], outlier: false, declarations: 4 },
      { value: "13px", count: 2, pages: ["/about"], outlier: true, declarations: 1 },
    ],
    spacing: [
      { px: 16, count: 300, pages: ["/", "/pricing"], offGrid: false, outlier: false, declarations: 20 },
      { px: 13, count: 9, pages: ["/pricing", "/about"], offGrid: true, outlier: false, declarations: 2, handTyped: 2 },
    ],
    ...overrides,
  };
}

const snapshots: PreviewSource[] = [
  {
    id: "newer",
    capturedAt: 2_000,
    previews: [
      { key: "color:#fafafa", route: "/pricing", device: "desktop", theme: "light", file: "p1.webp", url: "https://abc.public.blob.vercel-storage.com/x/p1-k9.webp" },
    ],
  },
  {
    id: "older",
    capturedAt: 1_000,
    previews: [
      { key: "color:#fafafa", route: "/pricing", device: "phone", theme: "dark", file: "p0.webp" },
      { key: "spacing:13", route: "/about", device: "desktop", theme: "light", file: "p2.webp", url: "https://abc.private.blob.vercel-storage.com/x/p2-k9.webp" },
    ],
  },
];

test("hexes are looked up in the palette, in citation order, each once", () => {
  const refs = citedDesignRefs("#888888 on #0a0a0a, and #888888 again; #123456 isn't on the site", data());
  assert.deepEqual(refs, [
    { kind: "color", hex: "#888888", roles: ["text"] },
    { kind: "color", hex: "#0a0a0a", roles: ["background", "border"] },
  ]);
  assert.deepEqual(citedDesignRefs("#FAFAFA", data()), [{ kind: "color", hex: "#fafafa", roles: ["background"] }]);
});

test("a size/weight pair is one type style; a bare size is every style of that size, flagged first", () => {
  assert.deepEqual(citedDesignRefs("Inter 17px/500 is a one-off heading", data()), [
    { kind: "font", family: "Inter", sizePx: 17, weight: 500 },
  ]);
  const d = data({
    fonts: [
      ...data().fonts,
      { family: "Inter", sizePx: 17, weight: 700, count: 90, sample: null, tags: ["h2"], pages: ["/"], outlier: false },
    ],
  });
  assert.deepEqual(citedDesignRefs("17px headings", d), [
    { kind: "font", family: "Inter", sizePx: 17, weight: 500 },
    { kind: "font", family: "Inter", sizePx: 17, weight: 700 },
  ]);
});

test("a size in several scales is read by the words around it, then by what's flagged", () => {
  // 13px is a type style, a radius and a padding value.
  assert.deepEqual(citedDesignRefs("13px padding sits off the grid", data()), [{ kind: "spacing", px: 13 }]);
  assert.deepEqual(citedDesignRefs("a 13px corner radius on one card", data()), [{ kind: "radius", value: "13px" }]);
  assert.deepEqual(citedDesignRefs("13px captions", data()), [
    { kind: "font", family: "Inter", sizePx: 13, weight: 400 },
  ]);
  // No hint: the flagged values (the radius and the padding), not the common type size.
  assert.deepEqual(citedDesignRefs("13px", data()), [
    { kind: "spacing", px: 13 },
    { kind: "radius", value: "13px" },
  ]);
  // No hint, nothing flagged: every match, labelled apart downstream.
  assert.deepEqual(citedDesignRefs("16px", data()), [
    { kind: "font", family: "Inter", sizePx: 16, weight: 400 },
    { kind: "spacing", px: 16 },
  ]);
  // A value the scan never measured yields nothing.
  assert.deepEqual(citedDesignRefs("19px", data()), []);
});

test("usages carry the facts and the newest picture, and say when a picture is public", () => {
  const usages = designUsagesFor(
    { issue: "A stray near-white background on the pricing cards.", evidence: "#fafafa" },
    data(),
    snapshots,
  );
  assert.equal(usages.length, 1);
  const [u] = usages;
  assert.equal(u.key, "color:#fafafa");
  assert.equal(u.label, "#fafafa");
  assert.deepEqual(u.roles, ["background"]);
  assert.equal(u.flagged, true);
  assert.equal(u.declarations, 1);
  assert.equal(u.handTyped, 1);
  assert.deepEqual(u.preview, {
    snapshotId: "newer",
    file: "p1.webp",
    route: "/pricing",
    device: "desktop",
    theme: "light",
    capturedAt: 2_000,
    publicUrl: "https://abc.public.blob.vercel-storage.com/x/p1-k9.webp",
  });
  assert.equal(usageFacts(u), "12 uses as background on /pricing · 1 declaration, hand-typed · one-off");
});

test("the citation's values lead and its words decide the scale for the rest of the finding", () => {
  const usages = designUsagesFor(
    { issue: "Card padding is off the grid; the body text wraps it in 16px.", evidence: "13px padding" },
    data(),
    snapshots,
  );
  // "padding" in the citation reads the finding's 16px as padding too, not as the 16px type size.
  assert.deepEqual(
    usages.map((u) => u.label),
    ["13px padding", "16px padding"],
  );
  // A private store's picture is known about but not public.
  assert.equal(usages[0].preview?.file, "p2.webp");
  assert.equal(usages[0].preview?.publicUrl, undefined);
  assert.equal(usageFacts(usages[0]), "9 uses as padding on 2 pages (/pricing, /about) · 2 declarations, hand-typed · off-grid");

  // Without a hint in the citation, the finding's own words decide.
  const typed = designUsagesFor({ issue: "Body text is set in two sizes.", evidence: "16px" }, data(), []);
  assert.deepEqual(typed.map((u) => u.label), ["Inter 16px / 400"]);
  assert.equal(usageFacts(typed[0]), "900 uses (p) on 2 pages (/, /pricing) · 12 declarations");
});

test("pictures: the newest snapshot wins, and only public Blob URLs count as public", () => {
  assert.equal(previewFor("color:#fafafa", snapshots)?.snapshotId, "newer");
  assert.equal(previewFor("spacing:13", snapshots)?.snapshotId, "older");
  assert.equal(previewFor("radius:13px", snapshots), undefined);
  assert.equal(previewFor("color:#fafafa", [])?.snapshotId, undefined);
  assert.equal(publicImageUrl("https://abc.public.blob.vercel-storage.com/a.webp"), "https://abc.public.blob.vercel-storage.com/a.webp");
  assert.equal(publicImageUrl("https://abc.private.blob.vercel-storage.com/a.webp"), undefined);
  assert.equal(publicImageUrl("http://abc.public.blob.vercel-storage.com/a.webp"), undefined);
  assert.equal(publicImageUrl("not a url"), undefined);
  assert.equal(publicImageUrl(undefined), undefined);
});

test("facts read well for every kind, with and without declarations", () => {
  const usages = designUsagesFor({ issue: "", evidence: "13px radius, 17px/500, #0a0a0a" }, data(), []);
  assert.deepEqual(
    usages.map(usageFacts),
    [
      "2 uses on /about · 1 declaration · one-off",
      "4 uses (h3) on /pricing · 1 declaration, hand-typed · one-off",
      "412 uses as background/border on 4 pages (/, /pricing, /about, +1 more) · 9 declarations",
    ],
  );
  const legacy = designUsagesFor(
    { issue: "", evidence: "#0a0a0a" },
    data({ colors: [{ hex: "#0a0a0a", count: 5, roles: { text: 5, background: 0, border: 0 }, pages: ["/"], pct: 1, outlier: false, legacyUses: 5 }] }),
    [],
  );
  assert.equal(usageFacts(legacy[0]), "5 uses as text on /");
});

test("a filed issue embeds public pictures, names private ones, and states the facts for all", () => {
  const usages = designUsagesFor(
    { issue: "The Pro card breaks the system.", evidence: "#fafafa, 13px padding, 13px radius" },
    data(),
    snapshots,
  );
  assert.deepEqual(whereItRendersMarkdown(usages), [
    "",
    "## Where it renders",
    "",
    "![#fafafa on /pricing (desktop, light)](https://abc.public.blob.vercel-storage.com/x/p1-k9.webp)",
    "",
    "**`#fafafa`** — 12 uses as background on /pricing · 1 declaration, hand-typed · one-off. Pictured on /pricing (desktop, light).",
    "",
    "**`13px padding`** — 9 uses as padding on 2 pages (/pricing, /about) · 2 declarations, hand-typed · off-grid. Pictured on /about (desktop, light) in the Polishd dashboard (Design tab); the snapshot is stored privately, so the picture can't be embedded here.",
    "",
    "**`13px radius`** — 2 uses on /about · 1 declaration · one-off.",
  ]);
  // A loss, or a design finding citing nothing the scan holds, adds no section.
  assert.deepEqual(whereItRendersMarkdown([]), []);
  assert.deepEqual(whereItRendersMarkdown(undefined), []);
});
