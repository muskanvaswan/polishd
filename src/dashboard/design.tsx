/**
 * Polishd — the Design tab (server-rendered).
 *
 * Renders the site's design system as measured from its rendered pages —
 * a brand guideline reverse-engineered from the build: type specimens at
 * their real sizes, the palette as swatches with usage share, the radius
 * and spacing scales in use. Each section carries the deterministic
 * findings (outliers, WCAG contrast failures, off-grid spacing) as one
 * combined note, long lists collapse behind a client-side "Show more",
 * and the AI review card at the top adds the model's aesthetic read.
 */
import type { ReactNode } from "react";

import type {
  DesignFlag,
  DesignFlagSection,
  PolishdDesignData,
} from "../server/design";
import type { PolishdAISettingsPublic, PolishdDesignReview } from "../ai/types";
import DesignReviewCard, { RefreshMetricsButton } from "./design-review-card";
import ShowMore from "./show-more";

const border = "border-[#2e2e2e]";
const card = `border ${border} rounded-lg bg-[#0a0a0a]`;
const label = "text-[11px] font-medium uppercase tracking-[0.08em] text-[#666]";
const divider = `border-t ${border}`;

/** Rows shown before a list collapses behind "Show more". */
const VISIBLE_ROWS = 5;

function OutlierBadge({ text = "one-off" }: { text?: string }) {
  return (
    <span className="rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider bg-amber-950 text-amber-400">
      {text}
    </span>
  );
}

/**
 * The deterministic findings for one section, combined into a single note
 * rather than a stack of alert boxes — the container takes the strongest
 * severity, each finding is one line inside it.
 */
function SectionFlags({ flags, section }: { flags: DesignFlag[]; section: DesignFlagSection }) {
  const own = flags.filter((f) => f.section === section);
  if (own.length === 0) return null;
  const hasWarn = own.some((f) => f.severity === "warn");
  return (
    <div
      className={`mx-4 mt-4 rounded-md border px-3 py-2.5 sm:mx-5 ${
        hasWarn
          ? "border-amber-900/50 bg-amber-950/30"
          : "border-[#1e3a5f]/60 bg-[#0c1a2b]/60"
      }`}
    >
      <ul className={own.length > 1 ? "space-y-1.5" : undefined}>
        {own.map((f, i) => (
          <li
            key={i}
            className={`flex gap-2 text-[12px] leading-relaxed ${
              f.severity === "warn" ? "text-amber-400" : "text-[#7fb2e5]"
            }`}
          >
            {own.length > 1 && (
              <span
                aria-hidden
                className={`mt-[7px] h-1 w-1 shrink-0 rounded-full ${
                  f.severity === "warn" ? "bg-amber-400" : "bg-[#7fb2e5]"
                }`}
              />
            )}
            <span>{f.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Section({ title, tip, children }: { title: string; tip?: string; children: ReactNode }) {
  return (
    <section className="mb-8">
      <div className={`mb-3 flex items-baseline gap-2 ${label}`}>
        {title}
        {tip && <span className="normal-case tracking-normal text-[11px] font-normal text-[#444]">{tip}</span>}
      </div>
      {children}
    </section>
  );
}

// ── Typography ───────────────────────────────────────────────────────────────

function FontRow({ f, first }: { f: PolishdDesignData["fonts"][number]; first: boolean }) {
  return (
    <div
      className={`flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3 sm:px-5 ${first ? "" : divider}`}
    >
      <span
        className="min-w-0 flex-1 truncate text-white"
        style={{
          fontFamily: `"${f.family}", ui-sans-serif, system-ui, sans-serif`,
          fontSize: `${Math.min(f.sizePx, 34)}px`,
          fontWeight: f.weight,
          lineHeight: 1.25,
        }}
      >
        {f.sample || "The quick brown fox jumps over the lazy dog"}
      </span>
      <span className="flex shrink-0 items-center gap-1.5 text-[11px] tabular-nums text-[#666]">
        <span className="text-[#aaa]">
          {f.sizePx}px / {f.weight}
        </span>
        · {f.count.toLocaleString()} uses · {f.pages.length}{" "}
        {f.pages.length === 1 ? "page" : "pages"}
        {f.tags.length > 0 && <span className="text-[#444]">· {f.tags.join(", ")}</span>}
        {f.outlier && <OutlierBadge />}
      </span>
    </div>
  );
}

function TypographySection({ data }: { data: PolishdDesignData }) {
  const visible = data.fonts.slice(0, VISIBLE_ROWS);
  const overflow = data.fonts.slice(VISIBLE_ROWS, 40);
  return (
    <Section
      title="Typography"
      tip="— every family / size / weight combination rendered on the site, most used first."
    >
      <div className={`${card} overflow-hidden`}>
        <SectionFlags flags={data.flags} section="typography" />
        {data.families.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 px-4 pt-4 sm:px-5">
            {data.families.map((f) => (
              <span
                key={f.family}
                className="rounded-full border border-[#2e2e2e] px-2.5 py-1 text-[11px] text-[#aaa]"
              >
                {f.family} <span className="text-[#555]">· {f.count.toLocaleString()} uses</span>
              </span>
            ))}
          </div>
        )}
        <div className="mt-2">
          {visible.map((f, i) => (
            <FontRow key={`${f.family}|${f.sizePx}|${f.weight}`} f={f} first={i === 0} />
          ))}
          <ShowMore count={overflow.length} label="type styles">
            {overflow.map((f) => (
              <FontRow key={`${f.family}|${f.sizePx}|${f.weight}`} f={f} first={false} />
            ))}
          </ShowMore>
        </div>
      </div>
    </Section>
  );
}

// ── Palette ──────────────────────────────────────────────────────────────────

function roleLabel(roles: PolishdDesignData["colors"][number]["roles"]): string {
  const parts: string[] = [];
  if (roles.text > 0) parts.push("text");
  if (roles.background > 0) parts.push("bg");
  if (roles.border > 0) parts.push("border");
  return parts.join(" · ");
}

function ColorChip({ c }: { c: PolishdDesignData["colors"][number] }) {
  return (
    <span
      className="flex items-center gap-1.5 rounded-full border border-[#2e2e2e] py-1 pl-1.5 pr-2.5"
      title={`${c.hex} · ${c.pct}% · ${roleLabel(c.roles)} · ${c.pages.length} page(s)`}
    >
      <span
        className="h-4 w-4 rounded-full border border-[#2e2e2e]"
        style={{ backgroundColor: c.hex }}
      />
      <span className="font-mono text-[10px] text-[#999]">{c.hex}</span>
      {c.outlier && <OutlierBadge />}
    </span>
  );
}

function PaletteSection({ data }: { data: PolishdDesignData }) {
  const primary = data.colors.slice(0, 6);
  const chips = data.colors.slice(6, 6 + VISIBLE_ROWS);
  const overflow = data.colors.slice(6 + VISIBLE_ROWS, 48);
  return (
    <Section
      title="Color palette"
      tip="— the colors your pages actually paint, weighted by how much of the UI they cover."
    >
      <div className={`${card} overflow-hidden pb-4`}>
        <SectionFlags flags={data.flags} section="color" />
        {primary.length > 0 && (
          <div className="grid grid-cols-3 gap-3 px-4 pt-4 sm:grid-cols-6 sm:px-5">
            {primary.map((c) => (
              <div key={c.hex} className="min-w-0">
                <div
                  className="h-16 w-full rounded-md border border-[#2e2e2e]"
                  style={{ backgroundColor: c.hex }}
                />
                <div className="mt-1.5 truncate font-mono text-[11px] text-[#ccc]">{c.hex}</div>
                <div className="flex flex-wrap items-center gap-1 text-[10px] text-[#555]">
                  <span className="tabular-nums">{c.pct}%</span>
                  <span>· {roleLabel(c.roles)}</span>
                  {c.outlier && <OutlierBadge />}
                </div>
              </div>
            ))}
          </div>
        )}
        {chips.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2 px-4 sm:px-5">
            {chips.map((c) => (
              <ColorChip key={c.hex} c={c} />
            ))}
          </div>
        )}
        <ShowMore count={overflow.length} label="colors">
          <div className="mt-2 flex flex-wrap gap-2 px-4 pb-1 sm:px-5">
            {overflow.map((c) => (
              <ColorChip key={c.hex} c={c} />
            ))}
          </div>
        </ShowMore>
      </div>
    </Section>
  );
}

// ── Contrast ─────────────────────────────────────────────────────────────────

function ContrastRow({ p, first }: { p: PolishdDesignData["contrast"][number]; first: boolean }) {
  return (
    <div className={`flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5 ${first ? "" : divider}`}>
      <span
        className="flex h-9 w-14 shrink-0 items-center justify-center rounded-md border border-[#2e2e2e] text-[14px] font-medium"
        style={{ backgroundColor: p.bg, color: p.fg }}
      >
        Aa
      </span>
      <span className="font-mono text-[11px] text-[#999]">
        {p.fg} on {p.bg}
      </span>
      <span className="text-[12px] tabular-nums text-red-400">
        {p.ratio}:1 <span className="text-[#666]">(needs {p.required}:1 at {p.minSizePx}px)</span>
      </span>
      <span className="text-[11px] text-[#555]">
        {p.pages.slice(0, 2).join(", ")}
        {p.pages.length > 2 ? ", …" : ""}
      </span>
    </div>
  );
}

function ContrastSection({ data }: { data: PolishdDesignData }) {
  const failing = data.contrast.filter((p) => !p.passes);
  if (data.contrast.length === 0) return null;
  const visible = failing.slice(0, VISIBLE_ROWS);
  const overflow = failing.slice(VISIBLE_ROWS, 25);
  return (
    <Section
      title="Contrast"
      tip="— every text-on-background pairing measured against WCAG AA."
    >
      <div className={`${card} overflow-hidden`}>
        <SectionFlags flags={data.flags} section="contrast" />
        {failing.length === 0 ? (
          <p className="px-4 py-4 text-[13px] text-emerald-500 sm:px-5">
            All {data.contrast.length} measured text/background pairs meet WCAG AA. Nice.
          </p>
        ) : (
          <div className="mt-2">
            {visible.map((p, i) => (
              <ContrastRow key={`${p.fg}|${p.bg}`} p={p} first={i === 0} />
            ))}
            <ShowMore count={overflow.length} label="failing pairs">
              {overflow.map((p) => (
                <ContrastRow key={`${p.fg}|${p.bg}`} p={p} first={false} />
              ))}
            </ShowMore>
          </div>
        )}
      </div>
    </Section>
  );
}

// ── Radii & spacing ──────────────────────────────────────────────────────────

function RadiusChip({ r }: { r: PolishdDesignData["radii"][number] }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        className="h-12 w-12 border border-[#555] bg-[#161616]"
        style={{
          borderRadius: r.value === "full" ? "9999px" : r.value.replace(" (mixed)", ""),
        }}
      />
      <div className="flex items-center gap-1 text-[11px] text-[#999]">
        <span className="font-mono">{r.value}</span>
        {r.outlier && <OutlierBadge />}
      </div>
      <span className="text-[10px] tabular-nums text-[#555]">×{r.count.toLocaleString()}</span>
    </div>
  );
}

function RadiusSection({ data }: { data: PolishdDesignData }) {
  if (data.radii.length === 0) return null;
  const visible = data.radii.slice(0, VISIBLE_ROWS);
  const overflow = data.radii.slice(VISIBLE_ROWS, 20);
  return (
    <Section title="Corner radii" tip="— rounding in use on visible boxes and controls.">
      <div className={`${card} overflow-hidden pb-4`}>
        <SectionFlags flags={data.flags} section="radius" />
        <div className="flex flex-wrap items-end gap-4 px-4 pt-4 sm:px-5">
          {visible.map((r) => (
            <RadiusChip key={r.value} r={r} />
          ))}
        </div>
        <ShowMore count={overflow.length} label="radii">
          <div className="mt-2 flex flex-wrap items-end gap-4 px-4 pb-1 sm:px-5">
            {overflow.map((r) => (
              <RadiusChip key={r.value} r={r} />
            ))}
          </div>
        </ShowMore>
      </div>
    </Section>
  );
}

function SpacingRow({ s, max }: { s: PolishdDesignData["spacing"][number]; max: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-12 shrink-0 text-right font-mono text-[11px] tabular-nums text-[#999]">
        {s.px}px
      </span>
      <div className="h-3 flex-1 overflow-hidden rounded-sm bg-[#141414]">
        <div
          className={`h-full rounded-sm ${s.offGrid ? "bg-amber-500/70" : "bg-blue-500/80"}`}
          style={{ width: `${Math.max((s.px / max) * 100, 2)}%` }}
        />
      </div>
      <span className="w-16 shrink-0 text-right text-[11px] tabular-nums text-[#555]">
        ×{s.count.toLocaleString()}
      </span>
      <span className="w-14 shrink-0 text-[10px] text-amber-400">
        {s.offGrid ? "off-grid" : ""}
      </span>
    </div>
  );
}

function SpacingSection({ data }: { data: PolishdDesignData }) {
  if (data.spacing.length === 0) return null;
  const scale = [...data.spacing].sort((a, b) => a.px - b.px).slice(0, 24);
  const max = Math.max(...scale.map((s) => s.px), 1);
  const visible = scale.slice(0, VISIBLE_ROWS);
  const overflow = scale.slice(VISIBLE_ROWS);
  return (
    <Section title="Spacing" tip="— padding values in use, as a scale. Bars are to scale.">
      <div className={`${card} overflow-hidden pb-4`}>
        <SectionFlags flags={data.flags} section="spacing" />
        <div className="space-y-1.5 px-4 pt-4 sm:px-5">
          {visible.map((s) => (
            <SpacingRow key={s.px} s={s} max={max} />
          ))}
        </div>
        <ShowMore count={overflow.length} label="padding values">
          <div className="mt-1.5 space-y-1.5 px-4 pb-1 sm:px-5">
            {overflow.map((s) => (
              <SpacingRow key={s.px} s={s} max={max} />
            ))}
          </div>
        </ShowMore>
      </div>
    </Section>
  );
}

// ── Scanned pages ────────────────────────────────────────────────────────────

function PageRow({ p, first }: { p: PolishdDesignData["pages"][number]; first: boolean }) {
  return (
    <div
      className={`flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5 ${first ? "" : divider}`}
    >
      <span className="truncate font-mono text-[12px] text-[#ccc]">{p.path}</span>
      <span className="shrink-0 text-[11px] tabular-nums text-[#555]">
        {p.elements.toLocaleString()} elements ·{" "}
        {new Date(p.scannedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
      </span>
    </div>
  );
}

function ScannedPages({ data }: { data: PolishdDesignData }) {
  if (data.pages.length === 0) return null;
  const visible = data.pages.slice(0, VISIBLE_ROWS);
  const overflow = data.pages.slice(VISIBLE_ROWS);
  return (
    <Section title="Scanned pages" tip="— latest design scan per route; the dashboard itself is never scanned.">
      <div className={`${card} overflow-hidden`}>
        {visible.map((p, i) => (
          <PageRow key={p.path} p={p} first={i === 0} />
        ))}
        <ShowMore count={overflow.length} label="pages">
          {overflow.map((p) => (
            <PageRow key={p.path} p={p} first={false} />
          ))}
        </ShowMore>
      </div>
    </Section>
  );
}

// ── The tab ──────────────────────────────────────────────────────────────────

export interface DesignPanelProps {
  data: PolishdDesignData;
  review: PolishdDesignReview | null;
  reviewStale: boolean;
  settings: PolishdAISettingsPublic;
}

export function DesignPanel({ data, review, reviewStale, settings }: DesignPanelProps) {
  const hasScans = data.pages.length > 0;
  return (
    <main className="text-white">
      {/* Header */}
      <div className={`mb-8 flex items-start justify-between gap-3 border-b ${border} pb-6`}>
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-white">Design review</h1>
          <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-[#666]">
            Your site&apos;s brand guideline, reverse-engineered from the rendered pages — the
            typography, palette, radii and spacing it actually ships, with anything that breaks
            the system flagged.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <RefreshMetricsButton />
          <div
            className={`whitespace-nowrap rounded-full px-3 py-1 text-[11px] font-medium ${
              hasScans ? "bg-emerald-950 text-emerald-400" : "bg-[#1a1a1a] text-[#666]"
            }`}
          >
            {hasScans
              ? `● ${data.pages.length} ${data.pages.length === 1 ? "page" : "pages"} scanned`
              : "○ no scans yet"}
          </div>
        </div>
      </div>

      {!data.ready && (
        <div className="mb-8 rounded-lg border border-amber-900/50 bg-amber-950/30 px-4 py-3 text-[13px] text-amber-400">
          The analytics store isn&apos;t writable in this environment. Run locally or configure a
          database — see the <span className="font-mono text-amber-300">@polishd/next</span>{" "}
          DATABASE.md guide.
        </div>
      )}

      {data.ready && !hasScans && (
        <div className={`mb-8 ${card} px-5 py-8 text-center`}>
          <p className="text-[13px] text-[#888]">
            No design scans captured yet. Each page measures its own rendered design (fonts,
            colors, radii, spacing) once per visitor session — browse a few pages of the site,
            then refresh the metrics.
          </p>
        </div>
      )}

      {/* AI aesthetic read of the measured system */}
      <DesignReviewCard
        initialReview={review}
        initialStale={reviewStale}
        hasApiKey={settings.hasApiKey}
        provider={settings.provider}
        model={settings.model}
        scannedPages={data.pages.length}
      />

      {hasScans && (
        <>
          <TypographySection data={data} />
          <PaletteSection data={data} />
          <ContrastSection data={data} />
          <RadiusSection data={data} />
          <SpacingSection data={data} />
          <ScannedPages data={data} />
        </>
      )}
    </main>
  );
}
