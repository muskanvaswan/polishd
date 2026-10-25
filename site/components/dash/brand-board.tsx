/**
 * The Overview's brand board, palette half: the colors a site actually ships,
 * curated the way the brand kit is — one-offs left out — as one hierarchy
 * and no labels beyond the swatches' own.
 *
 * Ranked the way the dashboard ranks them: Primary is the color the site
 * paints its buttons and calls to action in, Secondary the page itself,
 * Accent the next distinct color — a second control color. Then the next six
 * most used as one scale, light to dark.
 *
 * The site measured is an editorial site: white pages, rust for every link
 * and button, teal for tags, warm stone neutrals.
 */

type Swatch = { rank?: "Primary" | "Secondary" | "Accent"; name: string; hex: string; light?: boolean };

const BRAND: Swatch[] = [
  { rank: "Primary", name: "Rust", hex: "#c2410c" },
  { rank: "Secondary", name: "White", hex: "#ffffff", light: true },
  { rank: "Accent", name: "Teal", hex: "#0f766e" },
];

const NEUTRALS: Swatch[] = [
  { name: "Neutral 100", hex: "#f5f1ea", light: true },
  { name: "Neutral 200", hex: "#e7e2d8", light: true },
  { name: "Neutral 400", hex: "#a8a29e", light: true },
  { name: "Neutral 500", hex: "#78716c" },
  { name: "Neutral 600", hex: "#57534e" },
  { name: "Neutral 900", hex: "#1c1917" },
];

function SwatchCell({ color: c, className, small = false }: { color: Swatch; className: string; small?: boolean }) {
  const ink = c.light ? "text-black/80" : "text-white/90";
  const quiet = c.light ? "text-black/55" : "text-white/60";
  return (
    <div
      className={`relative flex flex-col justify-end overflow-hidden rounded-lg border border-line ${className}`}
      style={{ backgroundColor: c.hex }}
    >
      <div className={`min-w-0 ${small ? "p-1.5" : "p-2.5"}`}>
        {!small && c.rank && (
          <div className={`text-[9px] font-semibold uppercase tracking-[0.08em] ${quiet}`}>{c.rank}</div>
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

export default function BrandBoard() {
  const [primary, ...rest] = BRAND;
  return (
    <div
      role="img"
      aria-label={`Brand palette: ${BRAND.map((c) => `${c.rank} ${c.name} ${c.hex}`).join(", ")}; neutrals light to dark: ${NEUTRALS.map((c) => c.hex).join(", ")}`}
    >
      <div className="grid grid-cols-3 gap-1.5">
        <SwatchCell color={primary} className="col-span-2 row-span-2 min-h-24" />
        {rest.map((c) => (
          <SwatchCell key={c.hex} color={c} className="min-h-12" />
        ))}
      </div>
      <div className="mt-1.5 grid grid-cols-6 gap-1.5">
        {NEUTRALS.map((c) => (
          <SwatchCell key={c.hex} color={c} className="aspect-[4/3]" small />
        ))}
      </div>
    </div>
  );
}
