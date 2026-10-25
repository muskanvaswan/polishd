import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  DesignColorUsage,
  DesignFontUsage,
  DesignRadiusUsage,
  DesignSpacingUsage,
  PolishdDesignData,
} from "../server/design";
import { brandKitCss, buildBrandKit, typefaceName } from "./brand-kit.ts";

function data(overrides: Partial<PolishdDesignData>): PolishdDesignData {
  return {
    ready: true,
    pages: [{ path: "/", scannedAt: 1_700_000_000_000, elements: 400 }],
    fonts: [],
    families: [],
    colors: [],
    contrast: [],
    radii: [],
    spacing: [],
    flags: [],
    ...overrides,
  };
}

function font(family: string, sizePx: number, weight: number, count: number, extra: Partial<DesignFontUsage> = {}): DesignFontUsage {
  return { family, sizePx, weight, count, sample: "Sample text", tags: ["p"], pages: ["/", "/about"], outlier: false, offScale: false, ...extra };
}

function color(hex: string, count: number, roles: Partial<DesignColorUsage["roles"]>, extra: Partial<DesignColorUsage> = {}): DesignColorUsage {
  return {
    hex,
    count,
    roles: { text: 0, background: 0, border: 0, ...roles },
    pages: ["/", "/about"],
    pct: count / 10,
    outlier: false,
    ...extra,
  };
}

test("one-offs the Design tab badges never reach the kit", () => {
  const kit = buildBrandKit(
    data({
      fonts: [font("Inter", 16, 400, 200), font("Inter", 17, 500, 1, { outlier: true, pages: ["/"] })],
      colors: [color("#111111", 300, { text: 300 }), color("#fafafa", 1, { background: 1 }, { outlier: true })],
      radii: [
        { value: "8px", count: 40, pages: ["/"], outlier: false, offScale: false },
        { value: "7px", count: 1, pages: ["/"], outlier: true, offScale: false },
      ] satisfies DesignRadiusUsage[],
    }),
  );
  assert.deepEqual(kit.typeScale.map((s) => s.sizePx), [16]);
  assert.deepEqual(kit.colors.map((c) => c.hex), ["#111111"]);
  assert.deepEqual(kit.radii.map((r) => r.px), [8]);
  assert.deepEqual(
    kit.omitted.map((o) => `${o.kind}:${o.label}`),
    ["type:Inter 17px Medium", "color:#fafafa", "radius:7px"],
  );
});

test("padding one-offs stay out too; off-scale alone doesn't", () => {
  const spacing = (px: number, count: number, outlier = false): DesignSpacingUsage => ({
    px,
    count,
    pages: outlier ? ["/"] : ["/", "/about"],
    offScale: px % 2 !== 0,
    outlier,
  });
  const many = buildBrandKit(data({ spacing: [spacing(8, 60), spacing(16, 40), spacing(7, 1, true)] }));
  assert.deepEqual(many.spacing.map((s) => s.px), [8, 16]);
  assert.deepEqual(many.omitted, [{ kind: "spacing", label: "7px" }]);
  // Hand-typed or not, a value that isn't a one-off is part of the system.
  const systemic = buildBrandKit(data({ spacing: [spacing(8, 60), spacing(6, 40)] }));
  assert.deepEqual(systemic.spacing.map((s) => [s.token, s.px]), [["1", 6], ["2", 8]]);
});

test("near-duplicate colors fold into the one used more", () => {
  const kit = buildBrandKit(
    data({
      colors: [
        color("#ffffff", 200, { background: 200 }),
        color("#fefefe", 20, { background: 15, border: 5 }),
        color("#ffffff1f", 30, { border: 30 }),
      ],
      contrast: [
        { fg: "#111111", bg: "#fefefe", count: 9, minSizePx: 14, ratio: 18.8, required: 4.5, passes: true, pages: ["/"] },
      ],
    }),
  );
  assert.deepEqual(kit.colors.map((c) => c.hex), ["#ffffff", "#ffffff1f"]);
  assert.deepEqual(kit.folded, [{ from: "#fefefe", into: "#ffffff" }]);
  assert.deepEqual(kit.colors[0].roles, ["background", "border"]);
  // A translucent tint keeps its own token, named for its opacity.
  assert.equal(kit.colors[1].name, "White 12%");
  assert.equal(kit.colors[1].token, "white-a12");
});

test("brand colors rank by use; neutrals run light to dark on the 50–950 steps", () => {
  const kit = buildBrandKit(
    data({
      colors: [
        color("#2563eb", 50, { background: 50 }),
        color("#111111", 400, { text: 400 }),
        color("#f4f4f5", 300, { background: 300 }),
        color("#dc2626", 20, { text: 20 }),
        color("#71717a", 90, { text: 90 }),
      ],
    }),
  );
  const brand = kit.colors.filter((c) => c.group === "brand");
  assert.deepEqual(brand.map((c) => [c.name, c.rank]), [["Blue 600", "Primary"], ["Red 600", "Secondary"]]);
  const neutral = kit.colors.filter((c) => c.group === "neutral");
  assert.deepEqual(neutral.map((c) => c.name), ["Neutral 100", "Neutral 500", "Neutral 950"]);
  assert.deepEqual(kit.surface, { background: "#f4f4f5", text: "#111111" });
});

test("fluid sizes snap together without chaining a run of 1px steps into one", () => {
  const kit = buildBrandKit(
    data({
      fonts: [
        font("Inter", 15, 400, 100),
        font("Inter", 16, 400, 40),
        font("Inter", 17, 400, 30),
        font("Inter", 30, 600, 20),
        font("Inter", 30.7, 600, 8),
      ],
    }),
  );
  assert.deepEqual(
    kit.typeScale.map((s) => [s.sizePx, s.count]),
    [[30, 28], [17, 30], [16, 40], [15, 100]],
  );
});

test("type steps are named outward from body by their ratio to it", () => {
  const sizes = [48, 36, 30, 24, 18, 16, 14, 12];
  const kit = buildBrandKit(
    data({ fonts: sizes.map((px) => font("Inter", px, px >= 24 ? 700 : 400, px === 16 ? 500 : 10)) }),
  );
  assert.deepEqual(
    kit.typeScale.map((s) => `${s.sizePx}:${s.name}`),
    ["48:Display", "36:Heading 1", "30:Heading 2", "24:Heading 3", "18:Body L", "16:Body", "14:Body S", "12:Caption"],
  );
  // Siblings at a size say how they differ, and share the step's token.
  const withSibling = buildBrandKit(data({ fonts: [font("Inter", 16, 400, 100), font("Inter", 16, 600, 20)] }));
  assert.deepEqual(
    withSibling.typeScale.map((s) => [s.name, s.token, s.lead]),
    [["Body", "body", true], ["Body · SemiBold", "body", false]],
  );
});

test("typefaces are named the way people name them, with a role each", () => {
  assert.equal(typefaceName("__Inter_d65c78"), "Inter");
  assert.equal(typefaceName("__Inter_Fallback_d65c78"), "Inter");
  assert.equal(typefaceName("__JetBrains_Mono_3c557b"), "JetBrains Mono");
  assert.equal(typefaceName("ui-sans-serif"), "System sans-serif");
  assert.equal(typefaceName("Instrument Serif"), "Instrument Serif");

  const kit = buildBrandKit(
    data({
      fonts: [
        font("__Inter_d65c78", 16, 400, 300),
        font("__Inter_d65c78", 16, 600, 40),
        font("Instrument Serif", 40, 400, 30),
        font("JetBrains Mono", 14, 400, 20),
      ],
    }),
  );
  assert.deepEqual(
    kit.typefaces.map((t) => [t.name, t.role, t.token, t.weights]),
    [
      ["Inter", "Primary", "sans", [400, 600]],
      ["Instrument Serif", "Display", "display", [400]],
      ["JetBrains Mono", "Monospace", "mono", [400]],
    ],
  );
});

test("pairings are the passing ones between kit colors, at the level they reach", () => {
  const pair = (fg: string, bg: string, minSizePx: number, count = 5) => ({
    fg,
    bg,
    count,
    minSizePx,
    ratio: 0,
    required: 4.5,
    passes: false,
    pages: ["/"],
  });
  const kit = buildBrandKit(
    data({
      colors: [
        color("#ffffff", 300, { background: 300 }),
        color("#111111", 200, { text: 200 }),
        color("#767676", 80, { text: 80 }),
        color("#949494", 40, { text: 40 }),
        color("#abcdef", 1, { text: 1 }, { outlier: true }),
      ],
      contrast: [
        pair("#111111", "#ffffff", 14, 50),
        pair("#767676", "#ffffff", 14, 20),
        // 3.04:1 — passes only because the site sets it large.
        pair("#949494", "#ffffff", 32, 10),
        pair("#949494", "#111111", 12, 1),
        // Fails AA: in use, but no guideline should repeat it.
        pair("#949494", "#767676", 14, 30),
        // Its color is a one-off, so the pairing goes with it.
        pair("#abcdef", "#ffffff", 14, 99),
      ],
    }),
  );
  assert.deepEqual(
    kit.pairings.map((p) => [p.fg, p.bg, p.level]),
    [
      ["#111111", "#ffffff", "AAA"],
      ["#767676", "#ffffff", "AA"],
      ["#949494", "#ffffff", "AA Large"],
      ["#949494", "#111111", "AA"],
    ],
  );
});

test("as CSS: one size per step, ranked aliases, and no comments when asked", () => {
  const kit = buildBrandKit(
    data({
      fonts: [font("Inter", 16, 400, 100), font("Inter", 16, 600, 20), font("Inter", 32, 700, 10)],
      colors: [color("#2563eb", 50, { background: 50 }), color("#111111", 400, { text: 400 })],
      radii: [
        { value: "8px", count: 30, pages: ["/"], outlier: false, offScale: false },
        { value: "8px (mixed)", count: 3, pages: ["/"], outlier: false, offScale: false },
        { value: "full", count: 9, pages: ["/"], outlier: false, offScale: false },
      ],
      spacing: [{ px: 4, count: 10, pages: ["/"], offScale: false, outlier: false }],
    }),
  );
  const css = brandKitCss(kit, "Acme");
  assert.match(css, /^\/\* Acme — brand tokens/);
  assert.match(css, /--color-blue-600: #2563eb; \/\* Blue 600 \*\//);
  assert.match(css, /--color-primary: var\(--color-blue-600\);/);
  assert.match(css, /--font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;/);
  assert.equal(css.match(/--text-body:/g)?.length, 1);
  assert.match(css, /--text-heading-1: 2rem;/);
  assert.match(css, /--radius-sm: 8px;\n\s+--radius-full: 9999px;/);
  assert.match(css, /--space-1: 4px;\n}\n$/);
  assert.doesNotMatch(brandKitCss(kit, "Acme", { comments: false }), /\/\* (Acme|Blue)/);
});

test("an empty measurement gives an empty kit, not a throw", () => {
  const kit = buildBrandKit(data({ pages: [] }));
  assert.deepEqual(
    [kit.colors, kit.typefaces, kit.typeScale, kit.radii, kit.spacing, kit.pairings, kit.omitted],
    [[], [], [], [], [], [], []],
  );
  assert.equal(kit.grid, null);
});
