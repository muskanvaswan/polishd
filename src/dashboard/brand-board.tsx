/**
 * Polishd — the brand board: the site's colors and type as two hierarchies.
 *
 * The Design tab lists everything the pages paint, drift included, and the
 * brand kit PDF curates that into a guideline. This is the kit's first page
 * on screen, cut down to what a brand board says at a glance:
 *
 *   • **The palette as a grid.** Primary largest, Secondary and Accent beside
 *     it, then the neutrals as one scale from light to dark. Not every color
 *     the site paints — the kit already dropped the one-offs, and this shows
 *     only the ranked brand colors and the most used neutrals.
 *   • **The type as a stack.** Title, subtitle, body and caption, one above
 *     the other, each set in its own face at the size the site really uses
 *     it. The roles are read off the kit's scale: the two largest heading
 *     steps, the body step, and the most used step below body.
 *
 * No `"use client"`: stateless markup, data in, pixels out. Specimens render
 * in the family the site uses, which the dashboard page has when it shares
 * the site's root layout and falls back to the system stack when it doesn't —
 * the same bargain the Design tab's type rows make.
 */
import {
  cssFamily,
  relativeLuminance,
  weightName,
  type BrandKit,
  type BrandKitColor,
  type BrandKitTypeStyle,
} from "../shared/brand-kit";
import { card, eyebrowCls } from "./ui";

/** Neutrals shown on the scale — the most used, light to dark. */
const NEUTRALS = 6;

const RANK_ORDER = { Primary: 0, Secondary: 1, Accent: 2 } as const;

export default function BrandBoard({ kit }: { kit: BrandKit }) {
  const brand = kit.colors
    .filter((c): c is BrandKitColor & { rank: keyof typeof RANK_ORDER } => c.group === "brand" && c.rank !== null)
    .sort((a, b) => RANK_ORDER[a.rank] - RANK_ORDER[b.rank] || b.pct - a.pct)
    .slice(0, 3);
  // The kit lists neutrals light to dark; keep that order for the most used.
  const used = new Set(
    kit.colors
      .filter((c) => c.group === "neutral")
      .sort((a, b) => b.pct - a.pct)
      .slice(0, NEUTRALS)
      .map((c) => c.hex),
  );
  const neutrals = kit.colors.filter((c) => used.has(c.hex));
  const type = typeRoles(kit);

  return (
    <div data-component="overview-brand" className={`${card} overflow-hidden`}>
      <div className="grid lg:grid-cols-2">
        <div className="p-4 sm:p-5">
          {brand.length === 0 && neutrals.length === 0 ? (
            <p className="text-[13px] text-fg-3">No colors measured yet.</p>
          ) : (
            <>
              {brand.length > 0 && <BrandGrid colors={brand} />}
              {neutrals.length > 0 && (
                <div className={brand.length > 0 ? "mt-4" : ""}>
                  <div className={`${eyebrowCls} mb-2`}>Neutrals · light to dark</div>
                  {/* Six across while the board is one column; three across once
                      it splits, so the names stay legible in half the width. */}
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-3">
                    {neutrals.map((c) => (
                      <Swatch key={c.hex} color={c} className="aspect-[4/3]" small />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        <div className="border-t border-line p-4 sm:p-5 lg:border-l lg:border-t-0">
          {type.length === 0 ? (
            <p className="text-[13px] text-fg-3">No type measured yet.</p>
          ) : (
            type.map((row, i) => <TypeRow key={row.role} row={row} kit={kit} first={i === 0} />)
          )}
        </div>
      </div>
    </div>
  );
}

// ── Colors ───────────────────────────────────────────────────────────────────

/**
 * The ranked brand colors, sized by rank: with three, Primary takes two
 * columns and both rows and the others stack beside it; with two, Primary
 * takes two columns of three; alone, it takes the row.
 */
function BrandGrid({ colors }: { colors: BrandKitColor[] }) {
  if (colors.length === 1) return <Swatch color={colors[0]} className="h-28" />;
  const [primary, ...rest] = colors;
  return (
    <div className="grid grid-cols-3 gap-2">
      <Swatch
        color={primary}
        className={`col-span-2 ${rest.length > 1 ? "row-span-2 min-h-28" : "h-28"}`}
      />
      {rest.map((c) => (
        <Swatch key={c.hex} color={c} className={rest.length > 1 ? "min-h-[3.25rem]" : "h-28"} />
      ))}
    </div>
  );
}

/** A color block with its rank, name and value set on the color itself. */
function Swatch({
  color: c,
  className,
  small = false,
}: {
  color: BrandKitColor;
  className: string;
  /** The neutral scale's cells: value only, no rank. */
  small?: boolean;
}) {
  // Legible on the swatch whatever its lightness: ink on light, paper on dark.
  const dark = relativeLuminance(c.hex) > 0.35;
  const ink = dark ? "text-black/80" : "text-white/90";
  const quiet = dark ? "text-black/55" : "text-white/60";
  return (
    <div
      title={`${c.name} · ${c.hex} · ${c.pct}% of the UI · ${c.roles.join(", ")}`}
      className={`relative flex flex-col justify-end overflow-hidden rounded-lg border border-line ${className}`}
      style={{ backgroundColor: c.hex }}
    >
      <div className={`min-w-0 ${small ? "p-1.5" : "p-2.5"}`}>
        {!small && c.rank && (
          <div className={`text-[10px] font-semibold uppercase tracking-[0.08em] ${quiet}`}>{c.rank}</div>
        )}
        <div className={`truncate font-medium ${small ? "text-[11px]" : "text-[13px]"} ${ink}`}>{c.name}</div>
        <div className={`truncate font-mono ${small ? "text-[10px]" : "text-[11px]"} ${quiet}`}>{c.hex}</div>
      </div>
    </div>
  );
}

// ── Type ─────────────────────────────────────────────────────────────────────

interface TypeRole {
  role: "Title" | "Subtitle" | "Body" | "Caption";
  style: BrandKitTypeStyle;
}

/**
 * The scale's lead styles sorted into the four roles a brand board names.
 * Body is the kit's body step; the two largest heading steps are title and
 * subtitle (a lone heading borrows the subtitle from the largest body-sized
 * step above body); the caption is the most used step below body.
 */
function typeRoles(kit: BrandKit): TypeRole[] {
  const leads = kit.typeScale.filter((s) => s.lead);
  const body = leads.find((s) => s.step === "Body") ?? [...leads].sort((a, b) => b.count - a.count)[0];
  if (!body) return [];
  const headings = leads.filter((s) => s.sizePx >= body.sizePx * 1.25).sort((a, b) => b.sizePx - a.sizePx);
  const larger = leads
    .filter((s) => s.sizePx > body.sizePx && s.sizePx < body.sizePx * 1.25)
    .sort((a, b) => b.sizePx - a.sizePx);
  const smaller = leads.filter((s) => s.sizePx < body.sizePx).sort((a, b) => b.count - a.count);

  const rows: TypeRole[] = [];
  const title = headings[0];
  const subtitle = headings[1] ?? larger[0];
  if (title) rows.push({ role: "Title", style: title });
  if (subtitle) rows.push({ role: "Subtitle", style: subtitle });
  rows.push({ role: "Body", style: body });
  if (smaller[0]) rows.push({ role: "Caption", style: smaller[0] });
  return rows;
}

/** Specimens are capped so a 72px display face doesn't take the card over. */
const MAX_SPECIMEN_PX = 40;

function TypeRow({ row, kit, first }: { row: TypeRole; kit: BrandKit; first: boolean }) {
  const { role, style } = row;
  const face = kit.typefaces.find((t) => t.family === style.family);
  const family = face ? cssFamily(face) : `"${style.family}", ui-sans-serif, system-ui, sans-serif`;
  return (
    <div className={`flex items-end justify-between gap-4 ${first ? "" : "mt-4 border-t border-line pt-4"}`}>
      <div className="min-w-0 flex-1">
        <div className={eyebrowCls}>{role}</div>
        <div
          className="mt-1.5 truncate text-fg"
          style={{
            fontFamily: family,
            fontSize: `${Math.min(style.sizePx, MAX_SPECIMEN_PX)}px`,
            fontWeight: style.weight,
            lineHeight: 1.15,
          }}
        >
          {style.sample || role}
        </div>
      </div>
      <div className="shrink-0 text-right text-[12px] leading-snug tabular-nums text-fg-3">
        <div className="text-fg-2">{style.familyName}</div>
        <div>
          {style.sizePx}px · {weightName(style.weight)}
        </div>
      </div>
    </div>
  );
}
