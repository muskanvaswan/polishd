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
 * Every flagged value opens a hover card picturing the element that carries
 * it, cropped from the newest snapshot that found it.
 */
import type { ReactNode } from "react";

import type {
  DesignFlag,
  DesignFlagSection,
  PolishdDesignData,
} from "../server/design";
import type { PolishdAISettingsPublic, PolishdDesignReview } from "../ai/types";
import type { PolishdSnapshot } from "../server/snapshots";
import { designValueKey, type DesignValueRef } from "../shared/design-values";
import DesignReviewCard, { RefreshMetricsButton } from "./design-review-card";
import SnapshotsCard from "./snapshots";
import { Annotated, ColorToken, ContrastMeter, contrastPercent } from "./design-tokens";
import OverflowRow from "./overflow-row";
import ShowMore from "./show-more";
import { border, card, divider, labelCls as label } from "./ui";
import ValuePreview, { type ValuePreviewRef, type ValuePreviewState } from "./value-preview";

/** Rows shown before a list collapses behind "Show more". */
const VISIBLE_ROWS = 5;

/** What the hover card can show for a value, looked up by `designValueKey`. */
type PreviewFor = (ref: DesignValueRef) => ValuePreviewState;

/**
 * Index the snapshots' value pictures. A value's newest picture wins, from
 * whichever snapshot took it — an older picture of a value that's still
 * flagged still shows where it lived. Without one, the newest snapshot's
 * "looked and didn't find it" is the next most useful thing to say.
 */
function previewIndex(snapshots: PolishdSnapshot[]): PreviewFor {
  const pictured = new Map<string, ValuePreviewRef>();
  for (const s of snapshots) {
    for (const p of s.previews ?? []) {
      if (pictured.has(p.key)) continue;
      pictured.set(p.key, {
        snapshotId: s.id,
        file: p.file,
        route: p.route,
        device: p.device,
        theme: p.theme,
        capturedAt: s.capturedAt,
      });
    }
  }
  const latest = snapshots[0];
  const missed = new Set(latest?.previewMisses ?? []);
  return (ref) => {
    const key = designValueKey(ref);
    const preview = pictured.get(key);
    if (preview) return { kind: "pictured", preview };
    if (latest && missed.has(key)) return { kind: "missed", capturedAt: latest.capturedAt };
    return { kind: "none", hasSnapshots: snapshots.length > 0 };
  };
}

/**
 * A value's markup, wrapped in its hover card when it's flagged — one-off or
 * off-grid — and rendered as a plain box otherwise.
 */
function Flaggable({
  flagged,
  value,
  label: valueLabel,
  pages,
  previews,
  className,
  flaggedClassName,
  children,
}: {
  flagged: boolean;
  value: DesignValueRef;
  label: string;
  pages: string[];
  previews: PreviewFor;
  className: string;
  /** Hover/focus treatment added only when the value opens a card. */
  flaggedClassName: string;
  children: ReactNode;
}) {
  if (!flagged) return <div className={className}>{children}</div>;
  return (
    <ValuePreview
      label={valueLabel}
      pages={pages}
      state={previews(value)}
      className={`${className} ${flaggedClassName}`}
    >
      {children}
    </ValuePreview>
  );
}

/** Rows highlight on hover and keyboard focus alike. */
const FLAGGED_ROW = "transition-colors hover:bg-[#111] focus-visible:bg-[#111]";

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
            <span>
              <Annotated text={f.message} />
            </span>
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

function FontRow({
  f,
  first,
  previews,
}: {
  f: PolishdDesignData["fonts"][number];
  first: boolean;
  previews: PreviewFor;
}) {
  return (
    <Flaggable
      flagged={f.outlier}
      value={{ kind: "font", family: f.family, sizePx: f.sizePx, weight: f.weight }}
      label={`${f.sizePx}px / ${f.weight}`}
      pages={f.pages}
      previews={previews}
      className={`flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3 sm:px-5 ${first ? "" : divider}`}
      flaggedClassName={FLAGGED_ROW}
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
    </Flaggable>
  );
}

function TypographySection({ data, previews }: { data: PolishdDesignData; previews: PreviewFor }) {
  const visible = data.fonts.slice(0, VISIBLE_ROWS);
  const overflow = data.fonts.slice(VISIBLE_ROWS, 40);
  return (
    <Section
      title="Typography"
      tip="— every family / size / weight combination rendered on the site, most used first. Hover a one-off to see where it renders."
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
            <FontRow
              key={`${f.family}|${f.sizePx}|${f.weight}`}
              f={f}
              first={i === 0}
              previews={previews}
            />
          ))}
          <ShowMore count={overflow.length} label="type styles">
            {overflow.map((f) => (
              <FontRow
                key={`${f.family}|${f.sizePx}|${f.weight}`}
                f={f}
                first={false}
                previews={previews}
              />
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

function colorRef(c: PolishdDesignData["colors"][number]): DesignValueRef {
  const roles = (["text", "background", "border"] as const).filter((r) => c.roles[r] > 0);
  return { kind: "color", hex: c.hex, roles: [...roles] };
}

function ColorChip({ c, previews }: { c: PolishdDesignData["colors"][number]; previews: PreviewFor }) {
  const chip = "flex items-center gap-1.5 rounded-full border border-[#2e2e2e] py-1 pl-1.5 pr-2.5";
  const body = (
    <>
      <span
        className="h-4 w-4 rounded-full border border-[#2e2e2e]"
        style={{ backgroundColor: c.hex }}
      />
      <span className="font-mono text-[10px] text-[#999]">{c.hex}</span>
      {c.outlier && <OutlierBadge />}
    </>
  );
  // A flagged chip's hover card carries everything the tooltip would.
  if (c.outlier) {
    return (
      <ValuePreview
        label={c.hex}
        pages={c.pages}
        state={previews(colorRef(c))}
        className={`${chip} transition-colors hover:border-[#555] focus-visible:border-[#777]`}
      >
        {body}
      </ValuePreview>
    );
  }
  return (
    <span
      className={chip}
      title={`${c.hex} · ${c.pct}% · ${roleLabel(c.roles)} · ${c.pages.length} page(s)`}
    >
      {body}
    </span>
  );
}

function PaletteSection({ data, previews }: { data: PolishdDesignData; previews: PreviewFor }) {
  const primary = data.colors.slice(0, 6);
  const chips = data.colors.slice(6, 48);
  return (
    <Section
      title="Color palette"
      tip="— the colors your pages actually paint, weighted by how much of the UI they cover. Hover a one-off to see where it renders."
    >
      <div className={`${card} overflow-hidden pb-4`}>
        <SectionFlags flags={data.flags} section="color" />
        {primary.length > 0 && (
          <div className="grid grid-cols-3 gap-3 px-4 pt-4 sm:grid-cols-6 sm:px-5">
            {primary.map((c) => (
              <Flaggable
                key={c.hex}
                flagged={c.outlier}
                value={colorRef(c)}
                label={c.hex}
                pages={c.pages}
                previews={previews}
                className="min-w-0"
                flaggedClassName="rounded-md focus-visible:ring-1 focus-visible:ring-amber-500/60"
              >
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
              </Flaggable>
            ))}
          </div>
        )}
        {chips.length > 0 && (
          <OverflowRow
            label="colors"
            className="mt-4 px-4 sm:px-5"
            rowClassName="flex flex-wrap gap-2"
          >
            {chips.map((c) => (
              <ColorChip key={c.hex} c={c} previews={previews} />
            ))}
          </OverflowRow>
        )}
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
      <span className="flex items-center gap-1.5 text-[11px] text-[#777]">
        <ColorToken hex={p.fg} /> on <ColorToken hex={p.bg} />
      </span>
      <span className="flex items-center gap-2">
        <ContrastMeter ratio={p.ratio} required={p.required} />
        <span className="text-[11px] tabular-nums text-[#666]">
          needs {contrastPercent(p.required)}% at {p.minSizePx}px
        </span>
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
      {/*
        No `SectionFlags` here, unlike every other section: the contrast flags
        say exactly what the rows below already show, pair for pair. They stay
        in the data because the AI digest reads them — with the page each
        failure was seen on, which the rows summarize.
      */}
      <div className={`${card} overflow-hidden`}>
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

function RadiusChip({ r, previews }: { r: PolishdDesignData["radii"][number]; previews: PreviewFor }) {
  return (
    <Flaggable
      flagged={r.outlier}
      value={{ kind: "radius", value: r.value }}
      label={`${r.value} radius`}
      pages={r.pages}
      previews={previews}
      className="flex flex-col items-center gap-1.5"
      flaggedClassName={`-m-1.5 rounded-md p-1.5 ${FLAGGED_ROW}`}
    >
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
    </Flaggable>
  );
}

function RadiusSection({ data, previews }: { data: PolishdDesignData; previews: PreviewFor }) {
  if (data.radii.length === 0) return null;
  const radii = data.radii.slice(0, 20);
  return (
    <Section
      title="Corner radii"
      tip="— rounding in use on visible boxes and controls. Hover a one-off to see where it renders."
    >
      <div className={`${card} overflow-hidden pb-4`}>
        <SectionFlags flags={data.flags} section="radius" />
        <OverflowRow
          label="radii"
          className="px-4 pt-4 sm:px-5"
          rowClassName="flex flex-wrap items-end gap-4"
        >
          {radii.map((r) => (
            <RadiusChip key={r.value} r={r} previews={previews} />
          ))}
        </OverflowRow>
      </div>
    </Section>
  );
}

function SpacingRow({
  s,
  max,
  previews,
}: {
  s: PolishdDesignData["spacing"][number];
  max: number;
  previews: PreviewFor;
}) {
  return (
    <Flaggable
      flagged={s.offGrid}
      value={{ kind: "spacing", px: s.px }}
      label={`${s.px}px padding`}
      pages={s.pages}
      previews={previews}
      className="flex items-center gap-3"
      flaggedClassName={`-mx-1.5 rounded px-1.5 ${FLAGGED_ROW}`}
    >
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
    </Flaggable>
  );
}

function SpacingSection({ data, previews }: { data: PolishdDesignData; previews: PreviewFor }) {
  if (data.spacing.length === 0) return null;
  const scale = [...data.spacing].sort((a, b) => a.px - b.px).slice(0, 24);
  const max = Math.max(...scale.map((s) => s.px), 1);
  const visible = scale.slice(0, VISIBLE_ROWS);
  const overflow = scale.slice(VISIBLE_ROWS);
  return (
    <Section
      title="Spacing"
      tip="— padding values in use, as a scale. Bars are to scale. Hover an off-grid value to see where it renders."
    >
      <div className={`${card} overflow-hidden pb-4`}>
        <SectionFlags flags={data.flags} section="spacing" />
        <div className="space-y-1.5 px-4 pt-4 sm:px-5">
          {visible.map((s) => (
            <SpacingRow key={s.px} s={s} max={max} previews={previews} />
          ))}
        </div>
        <ShowMore count={overflow.length} label="padding values">
          <div className="mt-1.5 space-y-1.5 px-4 pb-1 sm:px-5">
            {overflow.map((s) => (
              <SpacingRow key={s.px} s={s} max={max} previews={previews} />
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
  snapshots: PolishdSnapshot[];
  /** A known-in-advance reason captures will fail here, or null. */
  captureIssue: string | null;
}

export function DesignPanel({
  data,
  review,
  reviewStale,
  settings,
  snapshots,
  captureIssue,
}: DesignPanelProps) {
  const hasScans = data.pages.length > 0;
  const previews = previewIndex(snapshots);
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

      {/* The site as it actually renders — screenshots of every scanned page */}
      <SnapshotsCard initial={snapshots} captureIssue={captureIssue} />

      {/* AI aesthetic read of the measured system */}
      <DesignReviewCard
        initialReview={review}
        initialStale={reviewStale}
        hasApiKey={settings.hasApiKey}
        provider={settings.provider}
        model={settings.model}
        scannedPages={data.pages.length}
        githubConnected={settings.hasGithubToken && !!settings.githubRepo}
      />

      {hasScans && (
        <>
          <TypographySection data={data} previews={previews} />
          <PaletteSection data={data} previews={previews} />
          <ContrastSection data={data} />
          <RadiusSection data={data} previews={previews} />
          <SpacingSection data={data} previews={previews} />
          <ScannedPages data={data} />
        </>
      )}
    </main>
  );
}
