/**
 * Polishd — where a cited design value renders.
 *
 * A design finding cites values: `#fafafa`, `17px`, `13px padding`, `#888888
 * on #0a0a0a`. On their own those say *what* is wrong. This module turns
 * each citation into what the Design tab already knows about the value — how
 * much of the UI it covers, on which pages, how many declarations chose it
 * and whether any hand-typed it — and the picture of the element carrying it,
 * when a site snapshot took one (capture/core.ts shoots and frames those).
 *
 * That is what an actionable's card shows under the finding, what a filed
 * GitHub issue embeds under "Where it renders", and what the fix prompt tells
 * a coding agent, so a design fix starts from the element rather than from a
 * hex code.
 *
 * Matching is by the value, not by the sentence: a hex is looked up in the
 * palette; a px size is looked up in the type styles, the padding scale and
 * the radii, and when it sits in more than one of those the words around it
 * ("padding", "heading", "radius") pick the section, then the flagged value
 * wins. Nothing is ever invented — a value the scan never measured yields
 * nothing, however often the finding names it.
 *
 * Pure: no store, no DOM, no React. The test file pins the matching.
 */
import type { PolishdDesignUsage, PolishdDesignUsagePreview } from "../ai/types";
import type { PolishdDesignData } from "../server/design";
import type { PolishdSnapshot } from "../server/snapshots";
import { designValueKey, type DesignValueRef } from "./design-values";

/** The slice of the design data the matching reads. */
export type DesignValueSource = Pick<PolishdDesignData, "fonts" | "colors" | "radii" | "spacing">;

/** The slice of a snapshot the pictures come from. */
export type PreviewSource = Pick<PolishdSnapshot, "id" | "capturedAt" | "previews">;

/** At most this many values per finding — a citation names one or two. */
export const MAX_CITED_VALUES = 6;

/** 6- or 8-digit hexes, as the scanner normalizes them. */
const HEX = /#[0-9a-f]{6}(?:[0-9a-f]{2})?\b/gi;
/** "17px/500" or "17px / 500": a type style, size and weight. */
const FONT_STYLE = /(\d+(?:\.\d+)?)\s*px\s*\/\s*(\d{3})\b/gi;
/** Any px size. */
const PX = /(\d+(?:\.\d+)?)\s*px\b/gi;

type PxSection = "font" | "spacing" | "radius";

/**
 * Words that say which scale a px size belongs to. Checked against the whole
 * finding, so "13px padding is off-scale" reads 13px as padding even though
 * the site may also set 13px type somewhere.
 */
const SECTION_HINTS: Record<PxSection, RegExp> = {
  spacing: /\b(padding|paddings|spacing|gap|gaps|margin|margins|inset|off[- ]?grid|whitespace)\b/i,
  radius: /\b(radius|radii|rounded|rounding|corner|corners)\b/i,
  font: /\b(font|fonts|type|typography|typographic|text|heading|headings|body|caption|captions|label|labels|weight|size|sizes|line-height|leading)\b/i,
};

interface Candidate {
  section: PxSection;
  ref: DesignValueRef;
  flagged: boolean;
  /** Uses, for ordering within a section. */
  count: number;
}

function pxCandidates(px: number, data: DesignValueSource): Candidate[] {
  const out: Candidate[] = [];
  for (const f of data.fonts) {
    if (f.sizePx === px) {
      out.push({
        section: "font",
        ref: { kind: "font", family: f.family, sizePx: f.sizePx, weight: f.weight },
        flagged: f.outlier || f.offScale,
        count: f.count,
      });
    }
  }
  for (const s of data.spacing) {
    if (s.px === px) {
      out.push({ section: "spacing", ref: { kind: "spacing", px: s.px }, flagged: s.offScale, count: s.count });
    }
  }
  for (const r of data.radii) {
    // Radii read "6px", "6px (mixed)" — never "16px" for 6.
    if (new RegExp(`^${px}px(?:\\s|$)`).test(r.value)) {
      out.push({ section: "radius", ref: { kind: "radius", value: r.value }, flagged: r.outlier || r.offScale, count: r.count });
    }
  }
  return out;
}

/**
 * Narrow a px size's candidates to the section the finding is about. Words in
 * the citation itself decide first ("13px padding"), then words anywhere in
 * the finding; failing a hint, flagged values; failing that, every match
 * stays — each is labelled, so an extra picture costs less than a missing one.
 */
function pickSections(candidates: Candidate[], evidence: string, whole: string): Candidate[] {
  const sections = new Set(candidates.map((c) => c.section));
  if (sections.size <= 1) return candidates;
  for (const text of [evidence, whole]) {
    const hinted = candidates.filter((c) => SECTION_HINTS[c.section].test(text));
    if (hinted.length > 0 && new Set(hinted.map((c) => c.section)).size < sections.size) return hinted;
  }
  const flagged = candidates.filter((c) => c.flagged);
  return flagged.length > 0 ? flagged : candidates;
}

/** Flagged first, then most used — the order a reader wants them in. */
function byRelevance(a: Candidate, b: Candidate): number {
  return Number(b.flagged) - Number(a.flagged) || b.count - a.count;
}

/** Several type styles can share a size; two is enough to show the pattern. */
const MAX_FONTS_PER_SIZE = 2;

/**
 * The measured values a finding cites, in the order it cites them, each once:
 * the citation's first, then any more in `context` (the finding's wording).
 * Hexes are looked up in the palette. A `17px/500` is one type style. A bare
 * px size is looked up in every scale and narrowed by the words around it.
 */
export function citedDesignRefs(
  evidence: string,
  data: DesignValueSource,
  context = "",
): DesignValueRef[] {
  const text = context ? `${evidence}\n${context}` : evidence;
  const out: DesignValueRef[] = [];
  const seen = new Set<string>();
  const add = (ref: DesignValueRef) => {
    const key = designValueKey(ref);
    if (seen.has(key) || out.length >= MAX_CITED_VALUES) return;
    seen.add(key);
    out.push(ref);
  };

  // Every match with where it sits, so values come out in citation order
  // whatever their kind.
  const found: { at: number; refs: DesignValueRef[] }[] = [];

  for (const m of text.matchAll(HEX)) {
    const hex = m[0].toLowerCase();
    const color = data.colors.find((c) => c.hex.toLowerCase() === hex);
    if (!color) continue;
    const roles = (["text", "background", "border"] as const).filter((r) => color.roles[r] > 0);
    found.push({ at: m.index ?? 0, refs: [{ kind: "color", hex: color.hex, roles: [...roles] }] });
  }

  // Sizes already claimed by a size/weight pair aren't read again as bare sizes.
  const styled = new Set<number>();
  for (const m of text.matchAll(FONT_STYLE)) {
    const size = Number(m[1]);
    const weight = Number(m[2]);
    const refs = data.fonts
      .filter((f) => f.sizePx === size && f.weight === weight)
      .map((f): DesignValueRef => ({ kind: "font", family: f.family, sizePx: f.sizePx, weight: f.weight }));
    if (refs.length === 0) continue;
    styled.add(m.index ?? 0);
    found.push({ at: m.index ?? 0, refs });
  }

  for (const m of text.matchAll(PX)) {
    const at = m.index ?? 0;
    if (styled.has(at)) continue;
    const px = Number(m[1]);
    if (!Number.isFinite(px)) continue;
    const picked = pickSections(pxCandidates(px, data), evidence, text).sort(byRelevance);
    const refs: DesignValueRef[] = [];
    let fonts = 0;
    for (const c of picked) {
      if (c.section === "font" && fonts++ >= MAX_FONTS_PER_SIZE) continue;
      refs.push(c.ref);
    }
    if (refs.length) found.push({ at, refs });
  }

  found.sort((a, b) => a.at - b.at);
  for (const f of found) for (const ref of f.refs) add(ref);
  return out;
}

/** Public Blob URLs are the only stored image URLs anyone can open. */
export function publicImageUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname.endsWith(".public.blob.vercel-storage.com")
      ? url
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The newest picture of a value, from whichever snapshot took it. Snapshots
 * are newest first; an older picture of a value still flagged still shows
 * where it lived.
 */
export function previewFor(key: string, snapshots: PreviewSource[]): PolishdDesignUsagePreview | undefined {
  for (const s of snapshots) {
    const p = s.previews?.find((x) => x.key === key);
    if (!p) continue;
    const publicUrl = publicImageUrl(p.url);
    return {
      snapshotId: s.id,
      file: p.file,
      route: p.route,
      device: p.device,
      theme: p.theme,
      capturedAt: s.capturedAt,
      ...(publicUrl ? { publicUrl } : {}),
    };
  }
  return undefined;
}

/** How the Design tab names a value. */
export function usageLabel(ref: DesignValueRef): string {
  switch (ref.kind) {
    case "font":
      return `${ref.family} ${ref.sizePx}px / ${ref.weight}`;
    case "color":
      return ref.hex.toLowerCase();
    case "radius":
      return `${ref.value} radius`;
    case "spacing":
      return `${ref.px}px padding`;
  }
}

/** One cited value, as a usage, or null when the data doesn't hold it. */
function usageOf(
  ref: DesignValueRef,
  data: DesignValueSource,
  snapshots: PreviewSource[],
): PolishdDesignUsage | null {
  const key = designValueKey(ref);
  const base = { key, label: usageLabel(ref), preview: previewFor(key, snapshots) };
  const decl = (v: { declarations?: number; handTyped?: number; legacyUses?: number }) =>
    v.declarations === undefined || v.legacyUses
      ? {}
      : { declarations: v.declarations, ...(v.handTyped ? { handTyped: v.handTyped } : {}) };
  // Why a value is flagged: a one-off first, as the Design tab badges it.
  const flag = (oneOff: boolean, offScale: boolean) =>
    oneOff
      ? { flagged: true, flag: "one-off" as const }
      : offScale
        ? { flagged: true, flag: "off-scale" as const }
        : { flagged: false };
  switch (ref.kind) {
    case "color": {
      const c = data.colors.find((x) => x.hex.toLowerCase() === ref.hex.toLowerCase());
      if (!c) return null;
      const roles = (["text", "background", "border"] as const).filter((r) => c.roles[r] > 0);
      return { ...base, kind: "color", count: c.count, pages: c.pages, roles: [...roles], ...flag(c.outlier, false), ...decl(c) };
    }
    case "font": {
      const f = data.fonts.find(
        (x) => x.family === ref.family && x.sizePx === ref.sizePx && x.weight === ref.weight,
      );
      if (!f) return null;
      return { ...base, kind: "font", count: f.count, pages: f.pages, tags: f.tags, ...flag(f.outlier, f.offScale), ...decl(f) };
    }
    case "radius": {
      const r = data.radii.find((x) => x.value === ref.value);
      if (!r) return null;
      return { ...base, kind: "radius", count: r.count, pages: r.pages, ...flag(r.outlier, r.offScale), ...decl(r) };
    }
    case "spacing": {
      const s = data.spacing.find((x) => x.px === ref.px);
      if (!s) return null;
      return { ...base, kind: "spacing", count: s.count, pages: s.pages, ...flag(false, s.offScale), ...decl(s) };
    }
  }
}

/**
 * Where the values a finding cites render. The citation is read first, then
 * the finding's wording, so the evidence's values lead; the suggestion is
 * left out, since the values it names are where the fix goes, not where the
 * problem is.
 */
export function designUsagesFor(
  finding: { issue: string; evidence: string },
  data: DesignValueSource,
  snapshots: PreviewSource[],
): PolishdDesignUsage[] {
  const out: PolishdDesignUsage[] = [];
  for (const ref of citedDesignRefs(finding.evidence, data, finding.issue)) {
    const usage = usageOf(ref, data, snapshots);
    if (usage) out.push(usage);
  }
  return out;
}

const n = (v: number) => v.toLocaleString("en-US");

/** Pages, three at most, then how many more. */
function pageList(pages: string[]): string {
  if (pages.length === 0) return "";
  if (pages.length === 1) return `on ${pages[0]}`;
  const shown = pages.slice(0, 3).join(", ");
  return `on ${n(pages.length)} pages (${shown}${pages.length > 3 ? `, +${pages.length - 3} more` : ""})`;
}

/**
 * A usage's facts in one line, for prose that can't show the picture: a filed
 * issue's body, the fix prompt, a card's caption. "12 uses as background on 3
 * pages (/, /pricing, /about) · 1 declaration, hand-typed · one-off".
 */
export function usageFacts(u: PolishdDesignUsage): string {
  const uses = `${n(u.count)} ${u.count === 1 ? "use" : "uses"}`;
  const what =
    u.kind === "color" && u.roles?.length
      ? ` as ${u.roles.join("/")}`
      : u.kind === "font" && u.tags?.length
        ? ` (${u.tags.slice(0, 4).join(", ")})`
        : u.kind === "spacing"
          ? " as padding"
          : "";
  const parts = [[uses + what, pageList(u.pages)].filter(Boolean).join(" ")];
  if (u.declarations !== undefined) {
    parts.push(
      `${n(u.declarations)} ${u.declarations === 1 ? "declaration" : "declarations"}` +
        (u.handTyped ? `, ${u.handTyped === u.declarations ? "" : `${n(u.handTyped)} `}hand-typed` : ""),
    );
  }
  if (u.flagged) parts.push(u.flag ?? (u.kind === "spacing" ? "off-scale" : "one-off"));
  return parts.join(" · ");
}

/** Where a picture was taken: "/pricing (desktop, light)". */
export function previewCaption(p: PolishdDesignUsagePreview): string {
  return `${p.route} (${p.device}, ${p.theme})`;
}

/** Pictures a filed issue embeds at most — one per cited value, within reason. */
export const MAX_ISSUE_PICTURES = 3;

/**
 * The "Where it renders" section of a filed design issue, as markdown lines:
 * for each value the finding cites, its picture in place when the image is
 * somewhere GitHub can fetch it (a public Blob store), and the facts behind
 * it either way — how much of the UI it covers, on which pages, how it was
 * declared. A picture that exists but isn't public is named rather than
 * dropped, so the reader knows the dashboard has it. Empty when there are no
 * usages: a loss, or a design finding whose values the scan doesn't hold.
 */
export function whereItRendersMarkdown(usages: readonly PolishdDesignUsage[] | undefined): string[] {
  if (!usages?.length) return [];
  const lines = ["", "## Where it renders"];
  let pictured = 0;
  for (const u of usages) {
    const facts = `**\`${u.label}\`** — ${usageFacts(u)}.`;
    if (u.preview?.publicUrl && pictured < MAX_ISSUE_PICTURES) {
      pictured++;
      lines.push(
        "",
        `![${u.label} on ${previewCaption(u.preview)}](${u.preview.publicUrl})`,
        "",
        `${facts} Pictured on ${previewCaption(u.preview)}.`,
      );
    } else if (u.preview) {
      lines.push(
        "",
        `${facts} Pictured on ${previewCaption(u.preview)} in the Polishd dashboard (Design tab); ` +
          "the snapshot is stored privately, so the picture can't be embedded here.",
      );
    } else {
      lines.push("", facts);
    }
  }
  return lines;
}
