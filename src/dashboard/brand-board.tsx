/**
 * Polishd — the brand board: the site's colors and typefaces on one card.
 *
 * The Design tab lists everything the pages paint, drift included, and the
 * brand kit PDF curates that into a guideline. This is the kit's first page
 * on screen: the palette as a strip proportioned by how much of the UI each
 * color covers, the brand colors as named swatches with the neutrals beside
 * them, and each typeface set in its own face with the weights it ships in.
 * One-offs are already gone — `buildBrandKit` leaves them out — so what's
 * here is the system, not the leaks.
 *
 * No `"use client"`: stateless markup, data in, pixels out. Specimens render
 * in the family the site uses, which the dashboard page has when it shares
 * the site's root layout and falls back to the system stack when it doesn't —
 * the same bargain the Design tab's type rows make.
 */
import {
  cssFamily,
  weightName,
  type BrandKit,
  type BrandKitColor,
  type BrandKitTypeface,
} from "../shared/brand-kit";
import { border, card } from "./ui";

/** Brand colors shown as swatches, neutrals as chips, typefaces as specimens. */
const SWATCHES = 6;
const CHIPS = 8;
const TYPEFACES = 3;

const byUse = (a: { pct: number }, b: { pct: number }) => b.pct - a.pct;

export default function BrandBoard({ kit }: { kit: BrandKit }) {
  const brand = kit.colors.filter((c) => c.group === "brand").sort(byUse);
  const neutral = kit.colors.filter((c) => c.group === "neutral").sort(byUse);
  // A site with no chromatic color at all still has a palette: its grays.
  const swatches = (brand.length > 0 ? brand : neutral).slice(0, SWATCHES);
  const chips = (brand.length > 0 ? neutral : neutral.slice(SWATCHES)).slice(0, CHIPS);
  const faces = kit.typefaces.slice(0, TYPEFACES);

  return (
    <div data-component="overview-brand" className={`${card} overflow-hidden`}>
      <div className="grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="p-4 sm:p-5">
          <PaletteStrip colors={[...brand, ...neutral]} />
          {swatches.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-3">
              {swatches.map((c) => (
                <Swatch key={c.hex} color={c} />
              ))}
            </div>
          )}
          {chips.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {chips.map((c) => (
                <Chip key={c.hex} color={c} />
              ))}
            </div>
          )}
        </div>
        <div className={`border-t ${border} p-4 sm:p-5 lg:border-l lg:border-t-0`}>
          {faces.length === 0 ? (
            <p className="text-[12px] text-[#666]">No typefaces measured yet.</p>
          ) : (
            faces.map((t, i) => <Typeface key={t.family} face={t} first={i === 0} />)
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The palette as one bar, each color as wide as its share of the UI. A floor
 * keeps the accents visible: a brand blue is a sliver next to the whites and
 * near-blacks that paint most pages, and a sliver is still the point.
 */
function PaletteStrip({ colors }: { colors: BrandKitColor[] }) {
  if (colors.length === 0) return null;
  return (
    <div
      role="img"
      aria-label={`Palette: ${colors.map((c) => c.name).join(", ")}`}
      className={`flex h-10 overflow-hidden rounded-md border ${border}`}
    >
      {colors.map((c) => (
        <span
          key={c.hex}
          title={`${c.name} · ${c.hex} · ${c.pct}%`}
          className="min-w-0"
          style={{ flexGrow: Math.max(c.pct, 3), backgroundColor: c.hex }}
        />
      ))}
    </div>
  );
}

/**
 * A brand color: the swatch, its rank in the system, its name, its value. A
 * fixed width rather than a grid share, so one lone brand color — a site with
 * a single accent is common — reads as a card, not a sliver.
 */
function Swatch({ color: c }: { color: BrandKitColor }) {
  return (
    <div className="w-[7.5rem]" title={`${c.name} · ${c.hex} · ${c.pct}% · ${c.roles.join(", ")}`}>
      <div className={`h-14 w-full rounded-md border ${border}`} style={{ backgroundColor: c.hex }} />
      <div className="mt-1.5 h-3 text-[9px] font-semibold uppercase tracking-wider text-[#777]">
        {c.rank ?? ""}
      </div>
      <div className="truncate text-[12px] text-[#ddd]">{c.name}</div>
      <div className="truncate font-mono text-[10px] text-[#666]">
        {c.hex} <span className="text-[#444]">· {c.pct}%</span>
      </div>
    </div>
  );
}

function Chip({ color: c }: { color: BrandKitColor }) {
  return (
    <span
      title={`${c.hex} · ${c.pct}% · ${c.roles.join(", ")}`}
      className={`flex items-center gap-1.5 rounded-full border ${border} py-1 pl-1.5 pr-2.5`}
    >
      <span className={`h-4 w-4 rounded-full border ${border}`} style={{ backgroundColor: c.hex }} />
      <span className="text-[11px] text-[#aaa]">{c.name}</span>
      <span className="font-mono text-[10px] text-[#555]">{c.hex}</span>
    </span>
  );
}

function Typeface({ face: t, first }: { face: BrandKitTypeface; first: boolean }) {
  const family = cssFamily(t);
  // The name in its own face, at the heaviest weight the site sets it in.
  const weight = t.weights[t.weights.length - 1] ?? 400;
  return (
    <div className={first ? "" : `mt-4 border-t ${border} pt-4`}>
      <div className="flex items-baseline justify-between gap-3">
        <span
          className="min-w-0 truncate text-[26px] leading-none text-white"
          style={{ fontFamily: family, fontWeight: weight }}
        >
          {t.name}
        </span>
        <span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.08em] text-[#666]">
          {t.role}
        </span>
      </div>
      <p className="mt-2 truncate text-[13px] text-[#999]" style={{ fontFamily: family }}>
        {t.sample || "The quick brown fox jumps over the lazy dog"}
      </p>
      <div className="mt-1.5 text-[11px] text-[#555]">
        {t.weights.map(weightName).join(" · ")}
        <span className="text-[#444]"> · {t.pct}% of text</span>
      </div>
    </div>
  );
}
