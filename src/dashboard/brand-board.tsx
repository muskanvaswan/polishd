/**
 * Polishd — the brand board: the site's colors and type as two hierarchies.
 *
 * The Design tab lists everything the pages paint, drift included, and the
 * brand kit PDF curates that into a guideline. This is the kit's first page
 * on screen, cut down to what a brand board says at a glance and sized to
 * share a card with the snapshot gallery — no headings, the shapes and the
 * type carry it:
 *
 *   • **The palette as a grid.** The hierarchy a page actually has. Primary
 *     is the color the site paints its buttons and calls to action in — that
 *     is how you know: a white site's white if its buttons are white, a blue
 *     if they're blue, never a status red. Secondary is the page itself, and
 *     Accent the next distinct color — a second control color, else the
 *     leading brand color, else the text. Then the next six most used as one
 *     scale from light to dark. Not every color the site paints: the kit
 *     already dropped the one-offs. Scans from before control backgrounds
 *     were measured fall back to the leading brand color, which is usually
 *     the one.
 *   • **The type as a stack.** Title, subtitle, body and caption, one above
 *     the other, each role's own name set in its own face at the size the
 *     site really uses it — the specimen is the label. The roles are read off
 *     the kit's scale: the two largest heading steps, the body step, and the
 *     most used step below body.
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


/** The large swatches: the colors painting most of the UI, in this order. */
const RANKS = ["Primary", "Secondary", "Accent"] as const;
/** Colors on the scale under them — the next most used, light to dark. */
const SCALE = 6;

export default function BrandBoard({ kit }: { kit: BrandKit }) {
  const brand = leadColors(kit);
  const neutrals = [...kit.colors]
    .filter((c) => !brand.includes(c))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, SCALE)
    .sort((a, b) => relativeLuminance(b.hex) - relativeLuminance(a.hex));
  const type = typeRoles(kit);

  return (
    <div data-component="overview-brand" className="flex h-full flex-col">
      {brand.length === 0 && neutrals.length === 0 ? (
        <p className="text-[13px] text-fg-3">No colors measured yet.</p>
      ) : (
        <>
          {brand.length > 0 && <BrandGrid colors={brand} />}
          {neutrals.length > 0 && (
            <div
              className={`grid grid-cols-6 gap-1.5 ${brand.length > 0 ? "mt-1.5" : ""}`}
              role="img"
              aria-label={`Also in the palette, light to dark: ${neutrals.map((c) => c.name).join(", ")}`}
            >
              {neutrals.map((c) => (
                <Swatch key={c.hex} color={c} className="aspect-[4/3]" small />
              ))}
            </div>
          )}
        </>
      )}
      <div className="mt-4 flex-1 border-t border-line pt-4">
        {type.length === 0 ? (
          <p className="text-[13px] text-fg-3">No type measured yet.</p>
        ) : (
          type.map((row, i) => <TypeRow key={row.role} row={row} kit={kit} first={i === 0} />)
        )}
      </div>
    </div>
  );
}

// ── Colors ───────────────────────────────────────────────────────────────────

/**
 * The large swatches: the color the controls are painted in, the page's own
 * background, then the next distinct color — a second control color, the
 * brand color the kit ranks first, the text. Anything still missing is
 * filled from the most used colors left.
 */
function leadColors(kit: BrandKit): BrandKitColor[] {
  const byHex = new Map(kit.colors.map((c) => [c.hex, c]));
  const controls = kit.colors.filter((c) => c.controls > 0).sort((a, b) => b.controls - a.controls);
  const brandFirst = kit.colors.find((c) => c.group === "brand" && c.rank === "Primary");
  const lead: BrandKitColor[] = [];
  const push = (c: BrandKitColor | undefined) => {
    if (c && !lead.includes(c) && lead.length < RANKS.length) lead.push(c);
  };
  // Primary: what the buttons are painted in. Scans from before that was
  // measured fall back to the leading brand color, which is usually it.
  push(controls[0] ?? brandFirst);
  push(kit.surface.background ? byHex.get(kit.surface.background) : undefined);
  push(controls[1]);
  push(brandFirst);
  push(kit.surface.text ? byHex.get(kit.surface.text) : undefined);
  for (const c of [...kit.colors].sort((a, b) => b.pct - a.pct)) push(c);
  return lead;
}

/**
 * The most prominent colors, sized by rank: with three, Primary takes two
 * columns and both rows and the others stack beside it; with two, Primary
 * takes two columns of three; alone, it takes the row.
 */
function BrandGrid({ colors }: { colors: BrandKitColor[] }) {
  if (colors.length === 1) return <Swatch color={colors[0]} rank={RANKS[0]} className="h-20" />;
  const [primary, ...rest] = colors;
  return (
    <div className="grid grid-cols-3 gap-1.5">
      <Swatch
        color={primary}
        rank={RANKS[0]}
        className={`col-span-2 ${rest.length > 1 ? "row-span-2 min-h-20" : "h-20"}`}
      />
      {rest.map((c, i) => (
        <Swatch key={c.hex} color={c} rank={RANKS[i + 1]} className={rest.length > 1 ? "min-h-10" : "h-20"} />
      ))}
    </div>
  );
}

/** A color block with its rank, name and value set on the color itself. */
function Swatch({
  color: c,
  rank,
  className,
  small = false,
}: {
  color: BrandKitColor;
  /** Its place in the board's hierarchy, for the large swatches. */
  rank?: string;
  className: string;
  /** The scale's cells: name and value only, no rank. */
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
        {!small && rank && (
          <div className={`text-[9px] font-semibold uppercase tracking-[0.08em] ${quiet}`}>{rank}</div>
        )}
        <div className={`truncate font-medium ${small ? "text-[10px] leading-tight" : "text-[12px]"} ${ink}`}>
          {c.name}
        </div>
        <div className={`truncate font-mono ${small ? "text-[9px] leading-tight" : "text-[10px]"} ${quiet}`}>
          {c.hex}
        </div>
      </div>
    </div>
  );
}

// ── Type ─────────────────────────────────────────────────────────────────────

type TypeRoleName = "Title" | "Subtitle" | "Body" | "Caption";

interface TypeRole {
  role: TypeRoleName;
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

/**
 * Specimens are capped per role so a 72px display face doesn't take the card
 * over; the real size is in the label beside it.
 */
const SPECIMEN_CAP: Record<TypeRoleName, number> = { Title: 32, Subtitle: 22, Body: 15, Caption: 12 };

/** The role's own name, set in the style it names — the specimen is the label. */
function TypeRow({ row, kit, first }: { row: TypeRole; kit: BrandKit; first: boolean }) {
  const { role, style } = row;
  const face = kit.typefaces.find((t) => t.family === style.family);
  const family = face ? cssFamily(face) : `"${style.family}", ui-sans-serif, system-ui, sans-serif`;
  return (
    <div
      className={`flex items-baseline justify-between gap-4 ${first ? "" : "mt-2.5 border-t border-line pt-2.5"}`}
    >
      <div
        className="min-w-0 truncate text-fg"
        style={{
          fontFamily: family,
          fontSize: `${Math.min(style.sizePx, SPECIMEN_CAP[role])}px`,
          fontWeight: style.weight,
          lineHeight: 1.2,
        }}
      >
        {role}
      </div>
      <div className="shrink-0 whitespace-nowrap text-right text-[11px] tabular-nums text-fg-3">
        <span className="text-fg-2">{style.familyName}</span> · {style.sizePx}px · {weightName(style.weight)}
      </div>
    </div>
  );
}
