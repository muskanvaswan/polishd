/**
 * Polishd — a small PDF writer, for the brand kit download.
 *
 * Just enough of PDF 1.4 to lay out a designed document: filled and stroked
 * (optionally rounded) rectangles, lines, text in the three base-14 faces every
 * viewer carries, translucency, link annotations, and 8-bit stencil images —
 * glyphs rasterized in a typeface the PDF can't embed, drawn in any color.
 *
 * A dependency would do more, but the dashboard ships inside every host app's
 * bundle; this is a few hundred lines with no runtime requirements beyond
 * `CompressionStream` (streams go uncompressed without it).
 *
 * Coordinates are points with the origin at the **top left**, y growing down,
 * the way the layout thinks; the writer flips them into PDF space. Text
 * positions are baselines.
 *
 * Pure: no DOM. The test file checks the output parses as a PDF.
 */

export type Rgb = readonly [number, number, number];

export type PdfFont = "sans" | "sans-bold" | "mono";

const FONTS: Record<PdfFont, { key: string; base: string }> = {
  sans: { key: "F1", base: "Helvetica" },
  "sans-bold": { key: "F2", base: "Helvetica-Bold" },
  mono: { key: "F3", base: "Courier" },
};

// ── Metrics (Adobe's AFM widths for the base-14 faces, per 1000 em) ──────────

// Printable ASCII, 0x20–0x7E.
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778,
  722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278,
  278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const HELVETICA_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778,
  722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333,
  278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];
// The few WinAnsi extras the layout actually sets.
const EXTRA_WIDTHS: Record<number, [number, number]> = {
  0x85: [1000, 1000], // …
  0x91: [222, 278], // ‘
  0x92: [222, 278], // ’
  0x93: [333, 500], // “
  0x94: [333, 500], // ”
  0x95: [350, 350], // •
  0x96: [556, 556], // –
  0x97: [1000, 1000], // —
  0xa9: [737, 737], // ©
  0xb7: [278, 278], // ·
  0xd7: [584, 584], // ×
};

/** Unicode → WinAnsiEncoding for the code points outside Latin-1's overlap. */
const WIN_ANSI: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87,
  0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91,
  0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98,
  0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

/** Characters the base-14 faces can't set, swapped for the nearest they can. */
const STAND_INS: Record<string, string> = { "≈": "~", "→": "->", "←": "<-", "≥": ">=", "≤": "<=", "✓": "", "✕": "x" };

/** The string as WinAnsi codes; what can't be encoded is dropped, not garbled. */
function encode(str: string): number[] {
  const out: number[] = [];
  for (const ch of str) {
    const sub = STAND_INS[ch];
    if (sub !== undefined) {
      for (const c of sub) out.push(c.charCodeAt(0));
      continue;
    }
    const cp = ch.codePointAt(0)!;
    if ((cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff)) out.push(cp);
    else if (WIN_ANSI[cp]) out.push(WIN_ANSI[cp]);
    else if (cp === 0x09 || cp === 0x0a) out.push(0x20);
  }
  return out;
}

function codeWidth(code: number, font: PdfFont): number {
  if (font === "mono") return 600;
  const bold = font === "sans-bold";
  if (code >= 0x20 && code <= 0x7e) return (bold ? HELVETICA_BOLD : HELVETICA)[code - 0x20];
  const extra = EXTRA_WIDTHS[code];
  if (extra) return bold ? extra[1] : extra[0];
  return 556;
}

/** Width of `str` set in `font` at `size`, in points. */
export function textWidth(str: string, font: PdfFont, size: number, tracking = 0): number {
  const codes = encode(str);
  const units = codes.reduce((sum, c) => sum + codeWidth(c, font), 0);
  return (units / 1000) * size + tracking * Math.max(0, codes.length - 1);
}

/** `str`, cut with an ellipsis where it would overrun `max` points. */
export function fitText(str: string, font: PdfFont, size: number, max: number): string {
  if (textWidth(str, font, size) <= max) return str;
  let lo = 0;
  let hi = str.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (textWidth(`${str.slice(0, mid).trimEnd()}…`, font, size) <= max) lo = mid;
    else hi = mid - 1;
  }
  return lo === 0 ? "" : `${str.slice(0, lo).trimEnd()}…`;
}

/** Greedy word wrap to `max` points; a word longer than a line is cut. */
export function wrapText(str: string, font: PdfFont, size: number, max: number): string[] {
  const lines: string[] = [];
  for (const para of str.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (textWidth(next, font, size) <= max || !line) line = next;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(fitText(line, font, size, max));
  }
  return lines;
}

// ── Writing ──────────────────────────────────────────────────────────────────

const n = (v: number) => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? "0" : String(r);
};

const rgbOp = (c: Rgb, op: "rg" | "RG") => `${n(c[0] / 255)} ${n(c[1] / 255)} ${n(c[2] / 255)} ${op}`;

function pdfString(codes: number[]): string {
  let out = "(";
  for (const c of codes) {
    if (c === 0x28 || c === 0x29 || c === 0x5c) out += `\\${String.fromCharCode(c)}`;
    else if (c < 0x20 || c > 0x7e) out += `\\${c.toString(8).padStart(3, "0")}`;
    else out += String.fromCharCode(c);
  }
  return `${out})`;
}

/** A document-info string: UTF-16BE with a byte-order mark, as hex. */
function infoString(str: string): string {
  let hex = "FEFF";
  for (let i = 0; i < str.length; i++) hex += str.charCodeAt(i).toString(16).padStart(4, "0");
  return `<${hex}>`;
}

/** 8-bit coverage, row-major, top row first: 0 transparent, 255 solid. */
export interface PdfMask {
  width: number;
  height: number;
  alpha: Uint8Array;
}

interface ImageEntry {
  key: string;
  mask: PdfMask;
  color: Rgb;
}

/** Bezier handle length for a quarter circle. */
const KAPPA = 0.5523;

export class PdfPage {
  readonly ops: string[] = [];
  readonly links: { rect: [number, number, number, number]; url: string }[] = [];
  readonly width: number;
  readonly height: number;
  private readonly doc: PdfDocument;

  constructor(doc: PdfDocument, width: number, height: number) {
    this.doc = doc;
    this.width = width;
    this.height = height;
  }

  private y(v: number): number {
    return this.height - v;
  }

  private withOpacity(opacity: number | undefined, draw: () => void) {
    if (opacity === undefined || opacity >= 1) return draw();
    this.ops.push("q", `/${this.doc.opacityKey(opacity)} gs`);
    draw();
    this.ops.push("Q");
  }

  private path(x: number, y: number, w: number, h: number, r: number) {
    const top = this.y(y);
    const bottom = this.y(y + h);
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    if (r === 0) {
      this.ops.push(`${n(x)} ${n(bottom)} ${n(w)} ${n(h)} re`);
      return;
    }
    const k = r * KAPPA;
    const right = x + w;
    this.ops.push(
      `${n(x + r)} ${n(top)} m`,
      `${n(right - r)} ${n(top)} l`,
      `${n(right - r + k)} ${n(top)} ${n(right)} ${n(top - r + k)} ${n(right)} ${n(top - r)} c`,
      `${n(right)} ${n(bottom + r)} l`,
      `${n(right)} ${n(bottom + r - k)} ${n(right - r + k)} ${n(bottom)} ${n(right - r)} ${n(bottom)} c`,
      `${n(x + r)} ${n(bottom)} l`,
      `${n(x + r - k)} ${n(bottom)} ${n(x)} ${n(bottom + r - k)} ${n(x)} ${n(bottom + r)} c`,
      `${n(x)} ${n(top - r)} l`,
      `${n(x)} ${n(top - r + k)} ${n(x + r - k)} ${n(top)} ${n(x + r)} ${n(top)} c`,
      "h",
    );
  }

  /** A rectangle — filled, stroked, or both — with optional rounded corners. */
  rect(
    x: number,
    y: number,
    w: number,
    h: number,
    opts: { fill?: Rgb; stroke?: Rgb; lineWidth?: number; radius?: number; opacity?: number } = {},
  ) {
    if (!opts.fill && !opts.stroke) return;
    this.withOpacity(opts.opacity, () => {
      if (opts.fill) this.ops.push(rgbOp(opts.fill, "rg"));
      if (opts.stroke) this.ops.push(rgbOp(opts.stroke, "RG"), `${n(opts.lineWidth ?? 0.5)} w`);
      // A stroke is drawn inset by half its width so boxes keep their size.
      const inset = opts.stroke && !opts.fill ? (opts.lineWidth ?? 0.5) / 2 : 0;
      this.path(x + inset, y + inset, w - inset * 2, h - inset * 2, (opts.radius ?? 0) - inset);
      this.ops.push(opts.fill && opts.stroke ? "B" : opts.fill ? "f" : "S");
    });
  }

  line(x1: number, y1: number, x2: number, y2: number, color: Rgb, width = 0.5, opacity?: number) {
    this.withOpacity(opacity, () => {
      this.ops.push(
        rgbOp(color, "RG"),
        `${n(width)} w`,
        `${n(x1)} ${n(this.y(y1))} m`,
        `${n(x2)} ${n(this.y(y2))} l`,
        "S",
      );
    });
  }

  /** Text on a baseline. Returns the width set, in points. */
  text(
    str: string,
    x: number,
    y: number,
    opts: {
      font?: PdfFont;
      size: number;
      color: Rgb;
      align?: "left" | "center" | "right";
      opacity?: number;
      /** Extra space between characters, points. */
      tracking?: number;
    },
  ): number {
    const font = opts.font ?? "sans";
    const codes = encode(str);
    if (codes.length === 0) return 0;
    const width = textWidth(str, font, opts.size, opts.tracking);
    const left = opts.align === "center" ? x - width / 2 : opts.align === "right" ? x - width : x;
    this.withOpacity(opts.opacity, () => {
      this.ops.push(
        "BT",
        rgbOp(opts.color, "rg"),
        `/${FONTS[font].key} ${n(opts.size)} Tf`,
        opts.tracking ? `${n(opts.tracking)} Tc` : "0 Tc",
        `${n(left)} ${n(this.y(y))} Td`,
        `${pdfString(codes)} Tj`,
        "ET",
      );
    });
    return width;
  }

  /** A stencil — `mask`'s coverage painted in `color` — stretched over the box. */
  stencil(mask: PdfMask, x: number, y: number, w: number, h: number, color: Rgb, opacity?: number) {
    const key = this.doc.addImage(mask, color);
    this.withOpacity(opacity, () => {
      this.ops.push("q", `${n(w)} 0 0 ${n(h)} ${n(x)} ${n(this.y(y + h))} cm`, `/${key} Do`, "Q");
    });
  }

  /** Make a box on the page open `url`. */
  link(x: number, y: number, w: number, h: number, url: string) {
    this.links.push({ rect: [x, this.y(y + h), x + w, this.y(y)], url });
  }
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === "undefined") return null;
  try {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

const latin1 = (s: string) => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
};

export class PdfDocument {
  private readonly pages: PdfPage[] = [];
  private readonly opacities = new Map<number, string>();
  private readonly images: ImageEntry[] = [];

  addPage(width: number, height: number): PdfPage {
    const page = new PdfPage(this, width, height);
    this.pages.push(page);
    return page;
  }

  /** @internal */
  opacityKey(opacity: number): string {
    const a = Math.round(Math.max(0, Math.min(1, opacity)) * 100) / 100;
    let key = this.opacities.get(a);
    if (!key) this.opacities.set(a, (key = `GS${this.opacities.size + 1}`));
    return key;
  }

  /** @internal */
  addImage(mask: PdfMask, color: Rgb): string {
    const key = `Im${this.images.length + 1}`;
    this.images.push({ key, mask, color });
    return key;
  }

  /** Serialize. Async only because compression is. */
  async save(info: { title: string; subject?: string; creator?: string }): Promise<Uint8Array> {
    const chunks: Uint8Array[] = [];
    const offsets: number[] = [];
    let length = 0;
    const push = (bytes: Uint8Array) => {
      chunks.push(bytes);
      length += bytes.length;
    };
    const write = (s: string) => push(latin1(s));

    // Object numbers are fixed up front so cross-references can be written
    // in one pass: catalog, page tree, fonts, resources, then per page and
    // per image.
    let next = 1;
    const catalogId = next++;
    const pagesId = next++;
    const fontIds = Object.fromEntries(Object.keys(FONTS).map((f) => [f, next++])) as Record<PdfFont, number>;
    const resourcesId = next++;
    const infoId = next++;
    const imageIds = this.images.map(() => ({ image: next++, mask: next++ }));
    const pageIds = this.pages.map((p) => ({
      page: next++,
      contents: next++,
      annots: p.links.map(() => next++),
    }));

    const object = (id: number, body: string) => {
      offsets[id] = length;
      write(`${id} 0 obj\n${body}\nendobj\n`);
    };
    const streamObject = async (id: number, dict: string, data: Uint8Array) => {
      const packed = await deflate(data);
      offsets[id] = length;
      const bytes = packed ?? data;
      write(`${id} 0 obj\n<< ${dict}${packed ? " /Filter /FlateDecode" : ""} /Length ${bytes.length} >>\nstream\n`);
      push(bytes);
      write("\nendstream\nendobj\n");
    };

    write("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n");

    object(catalogId, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
    object(
      pagesId,
      `<< /Type /Pages /Kids [${pageIds.map((p) => `${p.page} 0 R`).join(" ")}] /Count ${this.pages.length} >>`,
    );
    for (const [font, id] of Object.entries(fontIds) as [PdfFont, number][]) {
      object(id, `<< /Type /Font /Subtype /Type1 /BaseFont /${FONTS[font].base} /Encoding /WinAnsiEncoding >>`);
    }
    const fontRes = (Object.keys(FONTS) as PdfFont[]).map((f) => `/${FONTS[f].key} ${fontIds[f]} 0 R`).join(" ");
    const gsRes = [...this.opacities.entries()]
      .map(([a, key]) => `/${key} << /Type /ExtGState /ca ${n(a)} /CA ${n(a)} >>`)
      .join(" ");
    const imgRes = this.images.map((img, i) => `/${img.key} ${imageIds[i].image} 0 R`).join(" ");
    object(
      resourcesId,
      `<< /ProcSet [/PDF /Text /ImageB /ImageC] /Font << ${fontRes} >> /ExtGState << ${gsRes} >> /XObject << ${imgRes} >> >>`,
    );
    const now = new Date();
    const pad = (v: number) => String(v).padStart(2, "0");
    const date = `D:${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
    object(
      infoId,
      `<< /Title ${infoString(info.title)}${info.subject ? ` /Subject ${infoString(info.subject)}` : ""} /Creator ${infoString(info.creator ?? "Polishd")} /Producer ${infoString("Polishd")} /CreationDate (${date}) >>`,
    );

    for (const [i, img] of this.images.entries()) {
      const { width, height, alpha } = img.mask;
      // The color is a flat image the size of the mask — it compresses to
      // almost nothing, and every viewer pairs it with its soft mask cleanly.
      const flat = new Uint8Array(width * height * 3);
      for (let p = 0; p < flat.length; p += 3) {
        flat[p] = img.color[0];
        flat[p + 1] = img.color[1];
        flat[p + 2] = img.color[2];
      }
      await streamObject(
        imageIds[i].image,
        `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /SMask ${imageIds[i].mask} 0 R`,
        flat,
      );
      await streamObject(
        imageIds[i].mask,
        `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceGray /BitsPerComponent 8`,
        alpha,
      );
    }

    for (const [i, page] of this.pages.entries()) {
      const ids = pageIds[i];
      const annots = ids.annots.length ? ` /Annots [${ids.annots.map((a) => `${a} 0 R`).join(" ")}]` : "";
      object(
        ids.page,
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${n(page.width)} ${n(page.height)}] /Resources ${resourcesId} 0 R /Contents ${ids.contents} 0 R${annots} >>`,
      );
      await streamObject(ids.contents, "", latin1(page.ops.join("\n")));
      for (const [j, link] of page.links.entries()) {
        const uri = pdfString(encode(link.url));
        object(
          ids.annots[j],
          `<< /Type /Annot /Subtype /Link /Rect [${link.rect.map(n).join(" ")}] /Border [0 0 0] /A << /S /URI /URI ${uri} >> >>`,
        );
      }
    }

    const xref = length;
    const count = next;
    let table = `xref\n0 ${count}\n0000000000 65535 f \n`;
    for (let id = 1; id < count; id++) table += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
    write(table);
    write(`trailer\n<< /Size ${count} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

    const out = new Uint8Array(length);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  }
}
