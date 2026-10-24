/**
 * Polishd — the brand kit, laid out as a PDF.
 *
 * Takes the curated kit (shared/brand-kit.ts) and sets it as a guideline
 * document, A4 landscape:
 *
 *   1. A cover in the site's own background and text colors, its name in
 *      its own display face, and a band of its palette.
 *   2. The palette — brand colors as large swatches, then the neutrals —
 *      and the text/background pairings that pass WCAG.
 *   3. Each typeface as a specimen, then the type scale step by step.
 *   4. Corner radii and the spacing scale, drawn to scale.
 *   5. The kit as CSS custom properties, and how it was made.
 *
 * The specimens have to be in the site's real typefaces or they say nothing,
 * and a PDF can only embed a font from its file — which a browser never
 * exposes. So text set in a brand face is rasterized by a `TypeRenderer` (in
 * the browser, a canvas using the fonts the page already loaded) and drawn as
 * a sharp stencil; labels, values and code stay real text, selectable and
 * searchable. Without a renderer, or for a face the page never loaded, the
 * specimen falls back to Helvetica and says so.
 */
import {
  brandKitCss,
  contrastBetween,
  typefaceName,
  weightName,
  type BrandKit,
  type BrandKitColor,
  type BrandKitTypeface,
} from "../shared/brand-kit";
import { fitText, PdfDocument, textWidth, wrapText, type PdfFont, type PdfMask, type PdfPage, type Rgb } from "./pdf";

// ── Rendering type in the site's own faces ───────────────────────────────────

/** Rasterized text and its box, in points relative to the pen on the baseline. */
export interface TypeRaster {
  mask: PdfMask;
  left: number;
  /** Distance from the box's top edge down to the baseline. */
  top: number;
  width: number;
  height: number;
}

export interface TypeRenderer {
  /** Whether `family` renders in its own face here rather than a fallback. */
  has(family: string, weight: number): boolean;
  /** Advance width of `text` at `size` points. */
  measure(text: string, family: string, weight: number, size: number): number;
  raster(text: string, family: string, weight: number, size: number): TypeRaster | null;
}

const GENERIC_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "math",
  "emoji",
  "-apple-system",
  "blinkmacsystemfont",
]);

function isGeneric(family: string): boolean {
  return GENERIC_FAMILIES.has(family.toLowerCase());
}

/**
 * The family as a canvas font stack. A system alias (`ui-sans-serif`) is the
 * browser's own face, so it always renders — but not every browser knows
 * every alias, so it carries the generic it stands for as a fallback.
 */
function cssFamily(family: string): string {
  if (!isGeneric(family)) return `"${family.replace(/["\\]/g, "\\$&")}"`;
  const lower = family.toLowerCase();
  if (lower.includes("mono")) return `${family}, ui-monospace, monospace`;
  if (lower === "ui-serif" || lower === "serif") return `${family}, serif`;
  return `${family}, system-ui, sans-serif`;
}

/** Pixels per point to rasterize at — print-sharp, bounded for huge display type. */
const RASTER_SCALE = 4;
const RASTER_MAX_PX = 4096;

/**
 * A renderer backed by a canvas and the fonts this document has loaded. Call
 * `load` with every face the kit uses before laying out: a web font the page
 * hasn't drawn yet isn't fetched until something asks for it.
 */
export function canvasTypeRenderer(): (TypeRenderer & { load(faces: { family: string; weight: number }[]): Promise<void> }) | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const font = (family: string, weight: number, px: number) => `${weight} ${px}px ${cssFamily(family)}`;
  const known = new Map<string, boolean>();

  return {
    async load(faces) {
      if (!document.fonts?.load) return;
      const loads = faces.map((f) => document.fonts.load(font(f.family, f.weight, 32), "Aa").catch(() => []));
      // A face that never arrives shouldn't hold the download hostage.
      await Promise.race([Promise.all(loads), new Promise((r) => setTimeout(r, 4000))]);
    },
    has(family, weight) {
      const key = `${family}|${weight}`;
      const cached = known.get(key);
      if (cached !== undefined) return cached;
      if (isGeneric(family)) return true;
      // The standard probe: a face that isn't there falls through to the
      // fallback, so it measures exactly like that fallback — against two
      // fallbacks, unless the face really is one of them.
      const probe = "mmmmmmmmmlli1WQ@#&";
      const widthIn = (stack: string) => {
        ctx.font = `${weight} 48px ${stack}`;
        return ctx.measureText(probe).width;
      };
      const css = cssFamily(family);
      const present = (["monospace", "serif"] as const).some((fallback) => widthIn(`${css}, ${fallback}`) !== widthIn(fallback));
      known.set(key, present);
      return present;
    },
    measure(text, family, weight, size) {
      ctx.font = font(family, weight, size);
      return ctx.measureText(text).width;
    },
    raster(text, family, weight, size) {
      ctx.font = font(family, weight, size);
      const m = ctx.measureText(text);
      const left = Math.ceil(m.actualBoundingBoxLeft);
      const ascent = Math.ceil(Math.max(m.actualBoundingBoxAscent, size * 0.8));
      const descent = Math.ceil(Math.max(m.actualBoundingBoxDescent, size * 0.25));
      const pad = 2;
      const widthPt = left + Math.ceil(m.actualBoundingBoxRight) + pad * 2;
      const heightPt = ascent + descent + pad * 2;
      const scale = Math.min(RASTER_SCALE, RASTER_MAX_PX / widthPt, RASTER_MAX_PX / heightPt);
      const w = Math.max(1, Math.ceil(widthPt * scale));
      const h = Math.max(1, Math.ceil(heightPt * scale));
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const g = c.getContext("2d", { willReadFrequently: true });
      if (!g) return null;
      g.scale(scale, scale);
      g.font = font(family, weight, size);
      g.textBaseline = "alphabetic";
      g.fillStyle = "#000";
      g.fillText(text, pad + left, pad + ascent);
      const rgba = g.getImageData(0, 0, w, h).data;
      const alpha = new Uint8Array(w * h);
      for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3];
      return {
        mask: { width: w, height: h, alpha },
        left: -(pad + left),
        top: pad + ascent,
        width: w / scale,
        height: h / scale,
      };
    },
  };
}

// ── Page furniture ───────────────────────────────────────────────────────────

/** A4 landscape. */
const W = 842;
const H = 595;
const M = 48;
const CW = W - M * 2;
/** Content stops here; the footer sits below. */
const LIMIT = H - 50;

const PAPER: Rgb = [255, 255, 255];
const INK: Rgb = [17, 17, 17];
const MUTED: Rgb = [107, 107, 107];
const FAINT: Rgb = [154, 154, 154];
const RULE: Rgb = [230, 230, 230];
const PANEL: Rgb = [245, 245, 244];

function rgb(hex: string): Rgb {
  const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  if (!m) return INK;
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

/** Black or white, whichever reads better on `hex`. */
function onColor(hex: string): Rgb {
  return contrastBetween(hex, "#000000") >= contrastBetween(hex, "#ffffff") ? [0, 0, 0] : [255, 255, 255];
}

const MONO_FAMILY = /mono|courier|consolas|menlo|code/i;

/** The stand-in base-14 face for a family the renderer can't draw. */
function standIn(family: string, weight: number): PdfFont {
  return MONO_FAMILY.test(family) ? "mono" : weight >= 600 ? "sans-bold" : "sans";
}

function rem(px: number): string {
  return `${Math.round((px / 16) * 1000) / 1000}rem`;
}

function list(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** CSS px to points: 96 to the inch against PDF's 72. */
const PT_PER_PX = 0.75;

const PANGRAM = "The quick brown fox jumps over the lazy dog";

interface Face {
  family: string;
  weight: number;
}

class KitDocument {
  private readonly doc = new PdfDocument();
  private readonly pages: PdfPage[] = [];
  private page!: PdfPage;
  private y = 0;
  private section = { number: "", chapter: "", title: "" };
  /** Brand faces the renderer couldn't draw, by name, for the colophon to own up to. */
  readonly missing = new Set<string>();

  private readonly kit: BrandKit;
  private readonly name: string;
  private readonly renderer: TypeRenderer | null;
  private readonly url: string | undefined;
  private readonly accent: Rgb;
  private readonly titleFace: Face;
  private readonly bodyFace: Face;
  private readonly date: string;

  constructor(kit: BrandKit, name: string, renderer: TypeRenderer | null, url: string | undefined, now: Date) {
    this.kit = kit;
    this.name = name;
    this.renderer = renderer;
    this.url = url;
    // The primary brand color carries the document's accents — if it holds up
    // on white. A pale brand color would vanish on paper.
    const primary = kit.colors.find((c) => c.rank === "Primary");
    this.accent = primary && contrastBetween(primary.hex, "#ffffff") >= 3 ? rgb(primary.hex) : INK;
    // Titles are set like the site's own headings: in its display face when
    // it has one, at the weight its largest heading in that face uses.
    const lead = kit.typeScale.filter((s) => s.lead);
    const display = kit.typefaces.find((t) => t.role === "Display")?.family;
    const heading =
      (display && kit.typeScale.find((s) => s.family === display)) ??
      lead.find((s) => s.step === "Display" || s.step.startsWith("Heading")) ??
      lead[0];
    const body = lead.find((s) => s.step === "Body") ?? lead[lead.length - 1];
    const fallbackFace = { family: "Helvetica", weight: 700 };
    this.titleFace = heading ? { family: heading.family, weight: heading.weight } : fallbackFace;
    this.bodyFace = body ? { family: body.family, weight: body.weight } : { family: "Helvetica", weight: 400 };
    this.date = now.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  }

  // ── Type ──

  private drawable(face: Face): boolean {
    const ok = !!this.renderer?.has(face.family, face.weight);
    if (!ok && face.family !== "Helvetica") this.missing.add(typefaceName(face.family));
    return ok;
  }

  private measure(text: string, face: Face, size: number): number {
    return this.drawable(face)
      ? this.renderer!.measure(text, face.family, face.weight, size)
      : textWidth(text, standIn(face.family, face.weight), size);
  }

  /** Cut `text` with an ellipsis to fit `max` points in `face`. */
  private fit(text: string, face: Face, size: number, max: number): string {
    if (!this.drawable(face)) return fitText(text, standIn(face.family, face.weight), size, max);
    if (this.measure(text, face, size) <= max) return text;
    let lo = 0;
    let hi = text.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (this.measure(`${text.slice(0, mid).trimEnd()}…`, face, size) <= max) lo = mid;
      else hi = mid - 1;
    }
    return lo === 0 ? "" : `${text.slice(0, lo).trimEnd()}…`;
  }

  /** The largest size up to `max` at which `text` fits `width`, floored at `min`. */
  private fitSize(text: string, face: Face, max: number, width: number, min = max * 0.4): number {
    const at = this.measure(text, face, max);
    return at <= width ? max : Math.max(min, Math.floor(max * (width / at) * 10) / 10);
  }

  /** Text in a brand face — rasterized when possible, Helvetica otherwise. */
  private type(
    text: string,
    x: number,
    y: number,
    face: Face,
    size: number,
    color: Rgb,
    opts: { max?: number; align?: "left" | "right"; opacity?: number } = {},
  ): number {
    const str = opts.max ? this.fit(text, face, size, opts.max) : text;
    if (!str) return 0;
    if (this.drawable(face)) {
      const width = this.renderer!.measure(str, face.family, face.weight, size);
      const left = opts.align === "right" ? x - width : x;
      const r = this.renderer!.raster(str, face.family, face.weight, size);
      if (r) {
        this.page.stencil(r.mask, left + r.left, y - r.top, r.width, r.height, color, opts.opacity);
        return width;
      }
    }
    return this.page.text(str, x, y, {
      font: standIn(face.family, face.weight),
      size,
      color,
      align: opts.align,
      opacity: opts.opacity,
    });
  }

  private label(text: string, x: number, y: number, color: Rgb = MUTED, size = 7) {
    return this.page.text(text.toUpperCase(), x, y, { font: "sans-bold", size, color, tracking: size * 0.14 });
  }

  private paragraph(text: string, x: number, y: number, width: number, opts: { size?: number; color?: Rgb; leading?: number } = {}): number {
    const size = opts.size ?? 9;
    const leading = opts.leading ?? size * 1.45;
    const lines = wrapText(text, "sans", size, width);
    lines.forEach((line, i) => this.page.text(line, x, y + i * leading, { size, color: opts.color ?? MUTED }));
    return lines.length * leading;
  }

  // ── Pages ──

  private addPage(): PdfPage {
    this.page = this.doc.addPage(W, H);
    this.pages.push(this.page);
    return this.page;
  }

  /** Open a section on a fresh page: chapter, title, intro. */
  private open(number: string, chapter: string, title: string, intro: string) {
    this.section = { number, chapter, title };
    const page = this.addPage();
    page.rect(0, 0, W, H, { fill: PAPER });
    this.label(`${number}  ${chapter}`, M, M + 4, this.accent, 7.5);
    const size = this.fitSize(title, this.titleFace, 30, CW);
    this.type(title, M, M + 44, this.titleFace, size, INK, { max: CW });
    const h = this.paragraph(intro, M, M + 66, 470, { size: 9.5 });
    this.y = M + 66 + h + 18;
  }

  /**
   * Make room for `h` points, continuing on a new page if needed — under the
   * section's title, or `heading` when what follows is something else.
   */
  private need(h: number, heading = `${this.section.title}, continued`) {
    if (this.y + h <= LIMIT) return;
    const page = this.addPage();
    page.rect(0, 0, W, H, { fill: PAPER });
    this.label(`${this.section.number}  ${this.section.chapter}`, M, M + 4, this.accent, 7.5);
    this.type(heading, M, M + 32, this.titleFace, 16, INK, { max: CW });
    this.y = M + 56;
  }

  private subhead(text: string, note?: string) {
    this.need(40);
    this.label(text, M, this.y, INK, 7.5);
    if (note) this.page.text(note, W - M, this.y, { size: 7.5, color: FAINT, align: "right" });
    this.page.line(M, this.y + 7, W - M, this.y + 7, RULE);
    this.y += 22;
  }

  private footers() {
    const total = this.pages.length;
    this.pages.forEach((page, i) => {
      if (i === 0) return; // the cover is full-bleed
      const y = H - 28;
      page.text(`${this.name} brand kit`, M, y, { font: "sans-bold", size: 7, color: FAINT });
      const offset = textWidth(`${this.name} brand kit`, "sans-bold", 7);
      page.text(`  ·  Measured from ${plural(this.kit.pages.length, "page")} of the live site  ·  ${this.date}`, M + offset, y, {
        size: 7,
        color: FAINT,
      });
      page.text(`${i + 1} / ${total}`, W - M, y, { size: 7, color: FAINT, align: "right" });
    });
  }

  // ── Cover ──

  cover() {
    const page = this.addPage();
    const bgHex = this.kit.surface.background ?? "#ffffff";
    const bg = rgb(bgHex);
    // The site's text color, if it reads on the site's background.
    const textHex = this.kit.surface.text;
    const ink = textHex && contrastBetween(textHex, bgHex) >= 4.5 ? rgb(textHex) : onColor(bgHex);
    page.rect(0, 0, W, H, { fill: bg });

    page.text("BRAND KIT", M, M + 8, { font: "sans-bold", size: 8, color: ink, tracking: 1.6, opacity: 0.7 });
    page.text(this.date, W - M, M + 8, { size: 8, color: ink, align: "right", opacity: 0.7 });

    const size = this.fitSize(this.name, this.titleFace, 68, CW, 28);
    this.type(this.name, M, 236, this.titleFace, size, ink, { max: CW });
    const lede = `A brand guideline reverse-engineered from ${plural(this.kit.pages.length, "page")} of the live site — the colors, type, corners and spacing it actually ships, with the one-offs left out.`;
    wrapText(lede, "sans", 12, 470).forEach((line, i) =>
      page.text(line, M, 236 + 34 + i * 17, { size: 12, color: ink, opacity: 0.78 }),
    );

    if (this.url) {
      const host = this.url.replace(/^https?:\/\//, "");
      const width = page.text(host, M, 236 + 34 + 3 * 17 + 14, { size: 9, color: ink, opacity: 0.6 });
      page.link(M, 236 + 34 + 3 * 17 + 4, width, 13, this.url);
    }

    // A band of the palette: brand colors first, then neutrals dark to light,
    // so the band reads as a gradient out of the brand.
    const band = [...this.kit.colors.filter((c) => c.group === "brand" && c.alpha === 1).slice(0, 6)];
    const neutrals = this.kit.colors.filter((c) => c.group === "neutral" && c.alpha === 1).reverse();
    band.push(...neutrals.slice(0, 12 - band.length));
    const bandTop = H - 132;
    if (band.length > 0) {
      const stripe = W / band.length;
      band.forEach((c, i) => page.rect(i * stripe, bandTop, stripe + 0.5, H - bandTop, { fill: rgb(c.hex) }));
      band.forEach((c, i) => {
        page.text(c.hex, i * stripe + 10, H - 14, { font: "mono", size: 6.5, color: onColor(c.hex), opacity: 0.75 });
      });
    }

    const facts = [
      plural(this.kit.colors.length, "color"),
      plural(this.kit.typefaces.length, "typeface"),
      plural(this.kit.typeScale.filter((s) => s.lead).length, "type size"),
      plural(this.kit.radii.length, "radius", "radii"),
      plural(this.kit.spacing.length, "spacing step"),
    ];
    page.text(facts.join("   ·   "), M, bandTop - 22, { size: 8.5, color: ink, opacity: 0.7 });
    if (this.kit.typefaces.length > 0) {
      page.text(`Set in ${list(this.kit.typefaces.map((t) => t.name))}`, W - M, bandTop - 22, {
        size: 8.5,
        color: ink,
        opacity: 0.7,
        align: "right",
      });
    }
  }

  // ── Color ──

  private colorUsage(c: BrandKitColor): string {
    const roles = c.roles.map((r) => (r === "background" ? "Backgrounds" : r === "text" ? "Text" : "Borders"));
    return `${roles.join(", ")} · ${c.pct}% · ${plural(c.pages, "page")}`;
  }

  /** A swatch; translucent colors are shown over light and dark so they read. */
  private swatch(c: BrandKitColor, x: number, y: number, w: number, h: number, radius: number) {
    if (c.alpha < 1) {
      this.page.rect(x, y, w, h, { fill: PAPER, radius });
      this.page.rect(x + w / 2, y, w / 2, h, { fill: INK });
      this.page.rect(x, y, w, h, { fill: rgb(c.hex), radius, opacity: c.alpha });
      this.page.rect(x, y, w, h, { stroke: RULE, radius, lineWidth: 0.75 });
      return;
    }
    this.page.rect(x, y, w, h, { fill: rgb(c.hex), radius });
    if (contrastBetween(c.hex, "#ffffff") < 1.2) this.page.rect(x, y, w, h, { stroke: RULE, radius, lineWidth: 0.75 });
  }

  palette() {
    const brand = this.kit.colors.filter((c) => c.group === "brand");
    const neutral = this.kit.colors.filter((c) => c.group === "neutral");
    if (brand.length + neutral.length === 0) return;
    this.open(
      "01",
      "Color",
      "Palette",
      `The ${plural(this.kit.colors.length, "color")} the site paints with, minus one-offs${this.kit.folded.length ? ` and near-duplicates (${plural(this.kit.folded.length, "shade")} folded into the token ${this.kit.folded.length === 1 ? "it was" : "they were"} meant to be)` : ""}. Percentages are each color's share of everything painted.`,
    );

    if (brand.length > 0) {
      this.subhead("Brand colors", "Most used first");
      // A brand with one or two colors gets them wide, not a row of gaps.
      const cols = Math.min(4, brand.length);
      const gap = 14;
      const cw = (CW - gap * (cols - 1)) / cols;
      const sh = cols === 1 ? 84 : 96;
      for (let i = 0; i < brand.length; i += cols) {
        this.need(sh + 40);
        brand.slice(i, i + cols).forEach((c, j) => {
          const x = M + j * (cw + gap);
          const y = this.y;
          this.swatch(c, x, y, cw, sh, 6);
          const on = c.alpha < 1 ? INK : onColor(c.hex);
          if (c.rank) this.label(c.rank, x + 11, y + 17, on, 6.5);
          const name = fitText(c.name, "sans-bold", 11, cw - 22);
          if (c.alpha < 1) {
            this.page.rect(x + 6, y + sh - 40, Math.max(textWidth(name, "sans-bold", 11), textWidth(c.hex, "mono", 8.5)) + 10, 32, { fill: PAPER, radius: 3, opacity: 0.85 });
          }
          this.page.text(name, x + 11, y + sh - 25, { font: "sans-bold", size: 11, color: on });
          this.page.text(c.hex, x + 11, y + sh - 12, { font: "mono", size: 8.5, color: on, opacity: 0.85 });
          const [r, g, b] = rgb(c.hex);
          this.page.text(`RGB ${r} ${g} ${b}${c.alpha < 1 ? ` · ${Math.round(c.alpha * 100)}%` : ""}`, x, y + sh + 13, {
            font: "mono",
            size: 7.5,
            color: MUTED,
          });
          this.page.text(fitText(this.colorUsage(c), "sans", 7.5, cw), x, y + sh + 25, { size: 7.5, color: FAINT });
        });
        this.y += sh + 40;
      }
    }

    if (neutral.length > 0) {
      this.subhead("Neutrals", "Light to dark");
      // Up to eight a row, balanced: nine neutrals sit five and four.
      const cols = neutral.length <= 6 ? 6 : Math.ceil(neutral.length / Math.ceil(neutral.length / 8));
      const gap = 12;
      const tw = (CW - gap * (cols - 1)) / cols;
      const th = 54;
      for (let i = 0; i < neutral.length; i += cols) {
        this.need(th + 42);
        neutral.slice(i, i + cols).forEach((c, j) => {
          const x = M + j * (tw + gap);
          const y = this.y;
          this.swatch(c, x, y, tw, th, 5);
          this.page.text(fitText(c.name, "sans-bold", 8.5, tw), x, y + th + 13, { font: "sans-bold", size: 8.5, color: INK });
          this.page.text(c.hex, x, y + th + 24, { font: "mono", size: 7.5, color: MUTED });
          this.page.text(fitText(this.colorUsage(c), "sans", 6.5, tw), x, y + th + 35, { size: 6.5, color: FAINT });
        });
        this.y += th + 46;
      }
    }
  }

  pairings() {
    const pairs = this.kit.pairings;
    if (pairs.length === 0) return;
    const nameOf = new Map(this.kit.colors.map((c) => [c.hex, c.name]));
    this.open(
      "01",
      "Color",
      "Pairings",
      "Text-on-background combinations the site already uses that pass WCAG 2 AA. Set text on color with these; AAA reads comfortably at any size, AA Large only at 24px and up.",
    );
    const cols = 5;
    const gap = 12;
    const tw = (CW - gap * (cols - 1)) / cols;
    const th = 88;
    const face = this.bodyFace;
    for (let i = 0; i < pairs.length; i += cols) {
      this.need(th + 40);
      pairs.slice(i, i + cols).forEach((p, j) => {
        const x = M + j * (tw + gap);
        const y = this.y;
        const fg = rgb(p.fg);
        this.page.rect(x, y, tw, th, { fill: rgb(p.bg), radius: 6 });
        if (contrastBetween(p.bg, "#ffffff") < 1.2) this.page.rect(x, y, tw, th, { stroke: RULE, radius: 6, lineWidth: 0.75 });
        this.type("Aa", x + 12, y + 44, face, 30, fg);
        const caption = `${nameOf.get(p.fg) ?? p.fg} on ${nameOf.get(p.bg) ?? p.bg}`;
        this.page.text(fitText(caption, "sans", 7, tw - 24), x + 12, y + th - 12, { size: 7, color: fg, opacity: 0.85 });

        const ratio = `${p.ratio.toFixed(2)} : 1`;
        this.page.text(ratio, x, y + th + 15, { font: "sans-bold", size: 10, color: INK });
        const badgeW = textWidth(p.level, "sans-bold", 6.5, 0.6) + 10;
        this.page.rect(x + tw - badgeW, y + th + 6, badgeW, 12, {
          fill: p.level === "AA Large" ? FAINT : INK,
          radius: 6,
        });
        this.page.text(p.level, x + tw - badgeW / 2, y + th + 14.5, {
          font: "sans-bold",
          size: 6.5,
          color: PAPER,
          align: "center",
          tracking: 0.6,
        });
        this.page.text(`${p.fg} on ${p.bg}`, x, y + th + 27, { font: "mono", size: 7, color: MUTED });
      });
      this.y += th + 42;
    }
  }

  // ── Typography ──

  private typefaceColumn(t: BrandKitTypeface, x: number, width: number, y0: number, compact: boolean): number {
    const regular = t.weights.includes(400) ? 400 : t.weights[0] ?? 400;
    const face = { family: t.family, weight: regular };
    let y = y0;
    this.label(`${t.role} typeface`, x, y, this.accent, 7);
    y += 30;
    const nameSize = this.fitSize(t.name, face, compact ? 22 : 26, width);
    this.type(t.name, x, y, face, nameSize, INK, { max: width });
    y += compact ? 92 : 120;
    this.type("Aa", x - 2, y, face, compact ? 92 : 124, INK);
    y += 30;
    const lines = ["ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz", "0123456789 & @ ? ! % ( )"];
    const glyphSize = Math.min(...lines.map((l) => this.fitSize(l, face, 14, width, 7)));
    for (const line of lines) {
      this.type(line, x, y, face, glyphSize, INK, { max: width });
      y += glyphSize * 1.5;
    }
    y += 10;
    this.label("Weights in use", x, y, MUTED, 6.5);
    y += 16;
    for (const weight of t.weights.slice(0, 6)) {
      this.type(`${weightName(weight)} ${weight}`, x, y, { family: t.family, weight }, 12, INK, { max: width });
      y += 18;
    }
    y += 4;
    const note = `Sets ${t.pct}% of the site's text.${this.drawable(face) ? "" : ` Not loaded on this page, so shown in a stand-in face — install ${t.name} to see it.`}`;
    y += this.paragraph(note, x, y, width, { size: 7.5, color: FAINT });
    return y;
  }

  typefaces() {
    const faces = this.kit.typefaces;
    if (faces.length === 0) return;
    const names = faces.map((t) => t.name);
    this.open(
      "02",
      "Typography",
      "Typefaces",
      `${list(names)} — ${faces.length === 1 ? "the one family the site sets its text in" : `the ${faces.length} families the site sets its text in`}, with every weight it uses.`,
    );
    const perPage = 3;
    for (let i = 0; i < faces.length; i += perPage) {
      if (i > 0) {
        this.y = LIMIT; // force a continuation page
        this.need(1);
      }
      const group = faces.slice(i, i + perPage);
      const cols = Math.max(group.length, 2);
      const gap = 32;
      const colW = (CW - gap * (cols - 1)) / cols;
      group.forEach((t, j) => this.typefaceColumn(t, M + j * (colW + gap), colW, this.y, cols > 2));
    }
  }

  typeScale() {
    const styles = this.kit.typeScale;
    if (styles.length === 0) return;
    const steps = styles.filter((s) => s.lead).length;
    this.open(
      "02",
      "Typography",
      "Type scale",
      `${plural(steps, "step")}, largest first, named outward from body text. Each line is the site's own copy in that style, shown at its real size (large display type is scaled down to fit).`,
    );
    const nameW = 176;
    const specX = M + nameW + 16;
    const specW = W - M - specX;
    styles.forEach((s, i) => {
      const natural = s.sizePx * PT_PER_PX;
      const pt = Math.min(natural, 40);
      const rowH = Math.max(44, pt * 1.2 + 18);
      const top = this.y;
      this.need(rowH);
      if (this.y === top && i > 0) this.page.line(M, this.y, W - M, this.y, RULE);
      const y = this.y;
      this.page.text(fitText(s.name, s.lead ? "sans-bold" : "sans", 9.5, nameW), M, y + 17, {
        font: s.lead ? "sans-bold" : "sans",
        size: 9.5,
        color: INK,
      });
      this.page.text(
        `${s.sizePx}px · ${rem(s.sizePx)} · ${s.weight}${pt < natural ? " (scaled)" : ""}`,
        M,
        y + 28,
        { font: "mono", size: 7, color: MUTED },
      );
      const tags = s.tags.length ? `  ${s.tags.map((t) => `<${t}>`).join(" ")}` : "";
      this.page.text(fitText(`${s.familyName} ${weightName(s.weight)}${tags}`, "sans", 7, nameW), M, y + 38, {
        size: 7,
        color: FAINT,
      });
      // The site's own copy, unless it's too slight to show a face off ("1", "€12").
      const sample = s.sample && s.sample.replace(/[^\p{L}]/gu, "").length >= 5 ? s.sample : PANGRAM;
      const baseline = y + rowH / 2 + pt * 0.34;
      this.type(sample, specX, baseline, { family: s.family, weight: s.weight }, pt, INK, { max: specW });
      this.y += rowH;
    });
  }

  // ── Shape and space ──

  shapeAndSpace() {
    const { radii, spacing, grid } = this.kit;
    if (radii.length === 0 && spacing.length === 0) return;
    this.open(
      "03",
      "Shape & space",
      "Radii & spacing",
      "The corner radii and padding steps the site's boxes and controls are built from, drawn to scale.",
    );

    if (radii.length > 0) {
      this.subhead("Corner radii");
      const box = 64;
      const gap = 26;
      const perRow = Math.floor((CW + gap) / (box + gap));
      for (let i = 0; i < radii.length; i += perRow) {
        this.need(box + 44);
        radii.slice(i, i + perRow).forEach((r, j) => {
          const x = M + j * (box + gap);
          const y = this.y;
          const radius = r.px === null ? box / 2 : r.px * PT_PER_PX;
          this.page.rect(x, y, box, box, { fill: PANEL, stroke: INK, lineWidth: 1, radius });
          this.page.text(r.name, x, y + box + 15, { font: "sans-bold", size: 9, color: INK });
          this.page.text(r.px === null ? "9999px" : `${r.px}px`, x, y + box + 26, { font: "mono", size: 7.5, color: MUTED });
        });
        this.y += box + 44;
      }
    }

    if (spacing.length > 0) {
      this.subhead(
        "Spacing scale",
        grid ? `On a ${grid.unit}px grid — ${grid.pct}% of padding lands on it` : undefined,
      );
      const cols = spacing.length > 12 ? 2 : 1;
      const gap = 32;
      const colW = (CW - gap * (cols - 1)) / cols;
      const rows = Math.ceil(spacing.length / cols);
      const rowH = 17;
      const barX = 84;
      const maxPx = Math.max(...spacing.map((s) => s.px));
      // Every bar on one scale, so steps compare; the longest takes most of the row.
      const scale = Math.min(4, ((colW - barX) * 0.85) / (maxPx || 1));
      for (let r = 0; r < rows; r++) {
        this.need(rowH);
        for (let c = 0; c < cols; c++) {
          const s = spacing[c * rows + r];
          if (!s) continue;
          const x = M + c * (colW + gap);
          this.page.text(`space-${s.token}`, x, this.y + 10, { font: "mono", size: 7.5, color: INK });
          this.page.text(`${s.px}px`, x + barX - 8, this.y + 10, { font: "mono", size: 7.5, color: MUTED, align: "right" });
          this.page.rect(x + barX, this.y + 2, Math.max(1, s.px * scale), 10, { fill: this.accent, radius: 1.5, opacity: 0.85 });
        }
        this.y += rowH;
      }
      this.y += 8;
      this.page.text(`Bars are drawn to one scale: ${Math.round((scale / PT_PER_PX) * 10) / 10}× actual size.`, M, this.y, {
        size: 7,
        color: FAINT,
      });
      this.y += 10;
    }
  }

  // ── Tokens and colophon ──

  tokens() {
    this.open(
      "04",
      "Tokens",
      "Design tokens",
      "The kit as CSS custom properties — paste them into your global stylesheet to build with the system rather than around it. Colors, typefaces, type sizes and radii use Tailwind v4's theme names, so the same lines also work inside @theme { }.",
    );
    const lines = brandKitCss(this.kit, this.name, { comments: false }).trimEnd().split("\n");
    const size = 7;
    const leading = 10;
    const pad = 16;
    const gap = 20;
    const cols = 3;
    const colW = (CW - pad * 2 - gap * (cols - 1)) / cols;
    const chars = Math.floor(colW / (size * 0.6));
    // Long values wrap at a comma, continuing indented.
    const wrapped: string[] = [];
    for (const line of lines) {
      let rest = line;
      while (rest.length > chars) {
        const cut = rest.lastIndexOf(", ", chars);
        const at = cut > 8 ? cut + 1 : chars;
        wrapped.push(rest.slice(0, at));
        rest = `      ${rest.slice(at).trimStart()}`;
      }
      wrapped.push(rest);
    }

    // Column by column, as many rows as the page holds; a column never
    // opens on the blank line between two groups.
    let i = 0;
    while (i < wrapped.length) {
      this.need(80);
      const maxRows = Math.floor((LIMIT - this.y - pad * 2) / leading);
      const rows = Math.min(maxRows, Math.ceil((wrapped.length - i) / cols) + 1);
      const columns: string[][] = [];
      for (let c = 0; c < cols && i < wrapped.length; c++) {
        while (i < wrapped.length && wrapped[i].trim() === "") i++;
        columns.push(wrapped.slice(i, i + rows));
        i += rows;
      }
      const used = Math.max(...columns.map((c) => c.length));
      const panelH = used * leading + pad * 2 - 2;
      this.page.rect(M, this.y, CW, panelH, { fill: PANEL, radius: 8 });
      columns.forEach((column, c) => {
        column.forEach((line, row) => {
          const color = /^\s*\/\*/.test(line) ? FAINT : INK;
          this.page.text(line, M + pad + c * (colW + gap), this.y + pad + 6 + row * leading, { font: "mono", size, color });
        });
      });
      this.y += panelH + 24;
      if (i < wrapped.length) this.y = LIMIT; // continue on a new page
    }
  }

  colophon() {
    const kit = this.kit;
    const omitted = kit.omitted;
    const count = (kind: (typeof omitted)[number]["kind"]) => omitted.filter((o) => o.kind === kind).length;
    const parts = [
      [count("type"), "type style"],
      [count("color"), "color"],
      [count("radius"), "radius"],
      [count("spacing"), "padding value"],
    ]
      .filter(([c]) => (c as number) > 0)
      .map(([c, what]) => (what === "radius" ? plural(c as number, "radius", "radii") : plural(c as number, what as string)));
    const shown = kit.pages.slice(0, 8);
    const pageList = `${shown.join(", ")}${kit.pages.length > shown.length ? ` and ${kit.pages.length - shown.length} more` : ""}`;
    const measured = kit.measuredAt
      ? new Date(kit.measuredAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
      : this.date;

    const paragraphs = [
      `Polishd measured the computed styles of ${plural(kit.pages.length, "page")} of the site as visitors browsed them (${pageList}), most recently on ${measured}. Nothing here was read from source — this is what the build actually renders.`,
      parts.length
        ? `Left out as one-offs — values used on a single page by a sliver of its elements: ${list(parts)}${omitted.length ? ` (${omitted.slice(0, 10).map((o) => o.label).join(", ")}${omitted.length > 10 ? ", …" : ""})` : ""}. They're the drift a guideline exists to stop; the Design tab in Polishd shows where each one renders.`
        : "Nothing was left out: no value on the site reads as a one-off.",
    ];
    if (kit.folded.length) {
      paragraphs.push(
        `Near-duplicate colors folded into the token they drift from: ${kit.folded.slice(0, 8).map((f) => `${f.from} into ${f.into}`).join(", ")}${kit.folded.length > 8 ? ", …" : ""}.`,
      );
    }
    if (this.missing.size) {
      paragraphs.push(
        `${list([...this.missing])} ${this.missing.size === 1 ? "wasn't" : "weren't"} loaded where this kit was generated, so ${this.missing.size === 1 ? "its" : "their"} specimens use a stand-in face.`,
      );
    }

    const width = CW;
    const height = paragraphs.reduce((h, p) => h + wrapText(p, "sans", 8, width).length * 11.6 + 8, 0) + 22;
    this.need(height, "About this kit");
    this.subhead("How this kit was made");
    for (const p of paragraphs) this.y += this.paragraph(p, M, this.y, width, { size: 8, color: MUTED, leading: 11.6 }) + 8;
  }

  async save(): Promise<Uint8Array> {
    this.footers();
    return this.doc.save({
      title: `${this.name} — Brand kit`,
      subject: "Colors, typography, radii and spacing, measured from the live site by Polishd",
    });
  }
}

export interface BrandKitPdfOptions {
  /** What the cover calls the brand. */
  name: string;
  /** The site's origin, linked from the cover. */
  url?: string;
  /** Draws specimens in the site's own faces; Helvetica stands in without one. */
  renderer?: TypeRenderer | null;
  now?: Date;
}

/** Lay the kit out and serialize it. */
export async function brandKitPdf(kit: BrandKit, opts: BrandKitPdfOptions): Promise<Uint8Array> {
  const doc = new KitDocument(kit, opts.name, opts.renderer ?? null, opts.url, opts.now ?? new Date());
  doc.cover();
  doc.palette();
  doc.pairings();
  doc.typefaces();
  doc.typeScale();
  doc.shapeAndSpace();
  doc.tokens();
  doc.colophon();
  return doc.save();
}

/** Every face the PDF will try to draw, for the renderer to load first. */
export function brandKitFaces(kit: BrandKit): { family: string; weight: number }[] {
  const seen = new Map<string, { family: string; weight: number }>();
  const add = (family: string, weight: number) => seen.set(`${family}|${weight}`, { family, weight });
  for (const t of kit.typefaces) {
    add(t.family, t.weights.includes(400) ? 400 : t.weights[0] ?? 400);
    for (const w of t.weights) add(t.family, w);
  }
  for (const s of kit.typeScale) add(s.family, s.weight);
  return [...seen.values()];
}
