/**
 * Polishd — the Design tab (server-rendered).
 *
 * Renders the site's design system as measured from its rendered pages —
 * a brand guideline reverse-engineered from the build: type specimens at
 * their real sizes, the palette as swatches with usage share, the radius
 * and spacing scales in use. Each section carries the deterministic
 * findings (outliers, WCAG contrast failures, hand-typed values off the 2px
 * scale) as one quiet note, long lists collapse behind a client-side "Show more",
 * and the AI review card at the top adds the model's aesthetic read.
 * Every flagged value opens a hover card picturing the element that carries
 * it, cropped from the newest snapshot that found it. The header also hands
 * the same system over the other way round: curated into a brand kit, one-
 * offs left out, downloaded as a PDF.
 *
 * A value cited by a review issue the owner ignored or marked fixed is left
 * out of the notes (server/design-dismissals.ts) and marked as answered in
 * its row, its reason on hover, rather than badged.
 */
import type { ReactNode } from "react";

import type {
  DesignDismissal,
  DesignFlag,
  DesignFlagSection,
  PolishdDesignData,
} from "../server/design";
import {
  colorKey,
  contrastDismissal,
  radiusDismissal,
  spacingKey,
  typeKey,
} from "../server/design-dismissals";
import type { PolishdAISettingsPublic, PolishdDesignReview } from "../ai/types";
import type { PolishdSnapshot, SnapshotAvailability } from "../server/snapshots";
import { buildBrandKit } from "../shared/brand-kit";
import { shortBuild } from "../shared/build";
import { designPreviewTargets, designValueKey, type DesignValueRef } from "../shared/design-values";
import BrandKitButton from "./brand-kit-button";
import DesignReviewCard, { RefreshMetricsButton } from "./design-review-card";
import { SnapshotsProvider, SnapshotsSlot } from "./snapshots";
import { Annotated, ColorToken, ContrastMeter, contrastPercent } from "./design-tokens";
import OverflowRow from "./overflow-row";
import ShowMore from "./show-more";
import {
  Badge,
  Callout,
  Code,
  EmptyState,
  PageHeader,
  Section,
  StatusPill,
  card,
  divider,
} from "./ui";
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
function previewIndex(snapshots: PolishdSnapshot[], targets: Set<string>): PreviewFor {
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
    return {
      kind: "none",
      hasSnapshots: snapshots.length > 0,
      shotRoutes: latest ? [...new Set(latest.shots.map((s) => s.route))] : null,
      targeted: targets.has(key),
    };
  };
}

/**
 * A value's markup, wrapped in its hover card when it's flagged — one-off or
 * off-scale — and rendered as a plain box otherwise.
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
const FLAGGED_ROW = "transition-colors hover:bg-raised/60 focus-visible:bg-raised/60";

function OutlierBadge({ text = "one-off" }: { text?: string }) {
  return <Badge tone="warn">{text}</Badge>;
}

/** Hand-typed and off the 2px scale; `example` is the arbitrary class it's typed as. */
function OffScaleBadge({ example }: { example: string }) {
  return (
    <Badge tone="warn" title={`Hand-typed as an arbitrary value (${example}) and not a multiple of 2px`}>
      off-scale
    </Badge>
  );
}

/**
 * A flagged value the owner already answered through a review issue: marked
 * in neutral instead of badged, with the issue and its reason on hover.
 */
function DismissedBadge({ d }: { d: DesignDismissal }) {
  const verdict = d.fixed ? "fixed" : "ignored";
  const reason = d.reason?.replace(/[.!?…]+$/, "");
  const title =
    `${d.fixed ? "Marked fixed" : "Ignored"} with the review issue “${d.issue}”` +
    `${reason ? ` — ${reason}` : ""}. Left out of this section's checks.`;
  return (
    <Badge tone="neutral" title={title}>
      {verdict}
    </Badge>
  );
}

/**
 * A value's badges: the answer it was given, if it's flagged and answered;
 * otherwise what it's flagged for.
 */
function ValueBadges({
  outlier = false,
  offScale = false,
  example = "",
  dismissal,
}: {
  outlier?: boolean;
  offScale?: boolean;
  /** The arbitrary class an off-scale value is typed as, for its badge's hover text. */
  example?: string;
  dismissal?: DesignDismissal;
}) {
  if (!outlier && !offScale) return null;
  if (dismissal) return <DismissedBadge d={dismissal} />;
  return (
    <>
      {outlier && <OutlierBadge />}
      {offScale && <OffScaleBadge example={example} />}
    </>
  );
}

/**
 * How a value was decided: "1 declaration", "5 declarations · 2 hand-typed".
 * Empty for data scanned before declarations were measured.
 */
function declLabel(v: { declarations?: number; handTyped?: number; legacyUses?: number }): string {
  if (v.declarations === undefined || v.legacyUses) return "";
  const n = `${v.declarations.toLocaleString()} ${v.declarations === 1 ? "declaration" : "declarations"}`;
  return v.handTyped ? `${n} · ${v.handTyped.toLocaleString()} hand-typed` : n;
}

/**
 * The deterministic findings for one section, as one quiet note: a neutral
 * box, each finding a line led by a dot in its severity's color. They're
 * rule-based observations to weigh, not alarms, so the amber stays on the
 * values themselves — the badges and bars below.
 */
function SectionFlags({ flags, section }: { flags: DesignFlag[]; section: DesignFlagSection }) {
  const own = flags.filter((f) => f.section === section);
  if (own.length === 0) return null;
  return (
    <ul className="mx-4 mt-4 space-y-1 rounded-lg border border-line bg-sunken px-3.5 py-2.5 sm:mx-5">
      {own.map((f, i) => (
        <li key={i} className="flex gap-2.5 text-[12.5px] leading-relaxed text-fg-2">
          <span
            aria-hidden
            className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${
              f.severity === "warn" ? "bg-warn" : "bg-fg-4"
            }`}
          />
          <span>
            <Annotated text={f.message} />
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The Design tab's sections lead with a sentence about what they measure, so
 * that reads as the section's description rather than hiding behind a tip.
 * The source copy opens with an em-dash (it used to trail the title inline);
 * the dash is dropped now that it sits on its own line.
 */
function DesignSection({ title, tip, children }: { title: string; tip?: string; children: ReactNode }) {
  const lead = tip?.replace(/^—\s*/, "");
  return (
    <Section title={title} description={lead && lead[0].toUpperCase() + lead.slice(1)}>
      {children}
    </Section>
  );
}

// ── Typography ───────────────────────────────────────────────────────────────

function FontRow({
  f,
  first,
  previews,
  dismissal,
}: {
  f: PolishdDesignData["fonts"][number];
  first: boolean;
  previews: PreviewFor;
  dismissal?: DesignDismissal;
}) {
  return (
    <Flaggable
      flagged={f.outlier || f.offScale}
      value={{ kind: "font", family: f.family, sizePx: f.sizePx, weight: f.weight }}
      label={`${f.sizePx}px / ${f.weight}`}
      pages={f.pages}
      previews={previews}
      className={`flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3.5 sm:px-5 ${first ? "" : divider}`}
      flaggedClassName={FLAGGED_ROW}
    >
      <span
        className="min-w-0 flex-1 truncate text-fg"
        style={{
          fontFamily: `"${f.family}", ui-sans-serif, system-ui, sans-serif`,
          fontSize: `${Math.min(f.sizePx, 34)}px`,
          fontWeight: f.weight,
          lineHeight: 1.25,
        }}
      >
        {f.sample || "The quick brown fox jumps over the lazy dog"}
      </span>
      <span className="flex shrink-0 items-center gap-1.5 text-[12px] tabular-nums text-fg-3">
        <span className="rounded-md bg-raised px-1.5 py-0.5 font-mono text-[11.5px] text-fg-2 ring-1 ring-inset ring-line-strong">
          {f.sizePx}px / {f.weight}
        </span>
        {f.count.toLocaleString()} {f.count === 1 ? "use" : "uses"}
        {declLabel(f) && <> · {declLabel(f)}</>} · {f.pages.length}{" "}
        {f.pages.length === 1 ? "page" : "pages"}
        {f.tags.length > 0 && <span className="font-mono text-[11.5px]">· {f.tags.join(", ")}</span>}
        <ValueBadges
          outlier={f.outlier}
          offScale={f.offScale}
          example={`text-[${f.sizePx}px]`}
          dismissal={dismissal}
        />
      </span>
    </Flaggable>
  );
}

function TypographySection({ data, previews }: { data: PolishdDesignData; previews: PreviewFor }) {
  const visible = data.fonts.slice(0, VISIBLE_ROWS);
  const overflow = data.fonts.slice(VISIBLE_ROWS, 40);
  return (
    <DesignSection
      title="Typography"
      tip="— every family / size / weight combination rendered on the site, most used first. Hover a flagged style to see where it renders."
    >
      <div className={`${card} overflow-hidden`}>
        <SectionFlags flags={data.flags} section="typography" />
        {data.families.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 px-4 pt-4 sm:px-5">
            {data.families.map((f) => (
              <span
                key={f.family}
                className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-raised px-3 py-1 text-[12px] font-medium text-fg"
              >
                <span style={{ fontFamily: `"${f.family}", ui-sans-serif, system-ui, sans-serif` }}>
                  {f.family}
                </span>
                <span className="font-normal text-fg-3">
                  · {f.count.toLocaleString()} {f.count === 1 ? "use" : "uses"}
                </span>
              </span>
            ))}
          </div>
        )}
        <div className="mt-3">
          {visible.map((f, i) => (
            <FontRow
              key={`${f.family}|${f.sizePx}|${f.weight}`}
              f={f}
              first={i === 0}
              previews={previews}
              dismissal={data.dismissed?.[typeKey(f.sizePx)]}
            />
          ))}
          <ShowMore count={overflow.length} label="type styles">
            {overflow.map((f) => (
              <FontRow
                key={`${f.family}|${f.sizePx}|${f.weight}`}
                f={f}
                first={false}
                previews={previews}
                dismissal={data.dismissed?.[typeKey(f.sizePx)]}
              />
            ))}
          </ShowMore>
        </div>
      </div>
    </DesignSection>
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

function ColorChip({
  c,
  previews,
  dismissal,
}: {
  c: PolishdDesignData["colors"][number];
  previews: PreviewFor;
  dismissal?: DesignDismissal;
}) {
  const chip =
    "flex items-center gap-1.5 rounded-full border border-line-strong bg-raised py-1 pl-1 pr-2.5";
  const body = (
    <>
      <span
        className="h-[18px] w-[18px] rounded-full ring-1 ring-inset ring-fg/15"
        style={{ backgroundColor: c.hex }}
      />
      <span className="font-mono text-[11.5px] text-fg-2">{c.hex}</span>
      <ValueBadges outlier={c.outlier} dismissal={dismissal} />
    </>
  );
  // A flagged chip's hover card carries everything the tooltip would.
  if (c.outlier) {
    return (
      <ValuePreview
        label={c.hex}
        pages={c.pages}
        state={previews(colorRef(c))}
        className={`${chip} transition-colors hover:border-fg-4 focus-visible:border-fg-3`}
      >
        {body}
      </ValuePreview>
    );
  }
  return (
    <span
      className={chip}
      title={[c.hex, `${c.pct}%`, roleLabel(c.roles), declLabel(c), `${c.pages.length} page(s)`]
        .filter(Boolean)
        .join(" · ")}
    >
      {body}
    </span>
  );
}

function PaletteSection({ data, previews }: { data: PolishdDesignData; previews: PreviewFor }) {
  const primary = data.colors.slice(0, 6);
  const chips = data.colors.slice(6, 48);
  return (
    <DesignSection
      title="Color palette"
      tip="— the colors your pages actually paint, weighted by how much of the UI they cover. Hover a one-off to see where it renders."
    >
      <div className={`${card} overflow-hidden pb-4`}>
        <SectionFlags flags={data.flags} section="color" />
        {primary.length > 0 && (
          <div className="grid grid-cols-3 gap-3 px-4 pt-5 sm:grid-cols-6 sm:px-5">
            {primary.map((c) => (
              <Flaggable
                key={c.hex}
                flagged={c.outlier}
                value={colorRef(c)}
                label={c.hex}
                pages={c.pages}
                previews={previews}
                className="min-w-0"
                flaggedClassName="rounded-lg"
              >
                <div
                  className="h-20 w-full rounded-lg ring-1 ring-inset ring-fg/10"
                  style={{ backgroundColor: c.hex }}
                />
                <div className="mt-2 truncate font-mono text-[12px] font-medium text-fg">{c.hex}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11.5px] text-fg-3">
                  <span className="tabular-nums">{c.pct}%</span>
                  <span>· {roleLabel(c.roles)}</span>
                  <ValueBadges outlier={c.outlier} dismissal={data.dismissed?.[colorKey(c.hex)]} />
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
              <ColorChip key={c.hex} c={c} previews={previews} dismissal={data.dismissed?.[colorKey(c.hex)]} />
            ))}
          </OverflowRow>
        )}
      </div>
    </DesignSection>
  );
}

// ── Contrast ─────────────────────────────────────────────────────────────────

function ContrastRow({
  p,
  first,
  dismissal,
}: {
  p: PolishdDesignData["contrast"][number];
  first: boolean;
  dismissal?: DesignDismissal;
}) {
  return (
    <div className={`flex flex-wrap items-center gap-3 px-4 py-3.5 sm:px-5 ${first ? "" : divider}`}>
      <span
        className="flex h-10 w-14 shrink-0 items-center justify-center rounded-lg text-[15px] font-semibold ring-1 ring-inset ring-fg/10"
        style={{ backgroundColor: p.bg, color: p.fg }}
      >
        Aa
      </span>
      <span className="flex items-center gap-1.5 text-[12px] text-fg-3">
        <ColorToken hex={p.fg} /> on <ColorToken hex={p.bg} />
      </span>
      <span className="flex items-center gap-2.5">
        <ContrastMeter ratio={p.ratio} required={p.required} />
        <span className="text-[12px] tabular-nums text-fg-3">
          needs {contrastPercent(p.required)}% at {p.minSizePx}px
        </span>
      </span>
      <span className="font-mono text-[11.5px] text-fg-3">
        {p.pages.slice(0, 2).join(", ")}
        {p.pages.length > 2 ? ", …" : ""}
      </span>
      {dismissal && <DismissedBadge d={dismissal} />}
    </div>
  );
}

function ContrastSection({ data }: { data: PolishdDesignData }) {
  const failing = data.contrast.filter((p) => !p.passes);
  if (data.contrast.length === 0) return null;
  const visible = failing.slice(0, VISIBLE_ROWS);
  const overflow = failing.slice(VISIBLE_ROWS, 25);
  return (
    <DesignSection
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
          <p className="px-4 py-4 text-[13px] text-ok sm:px-5">
            All {data.contrast.length} measured text/background pairs meet WCAG AA. Nice.
          </p>
        ) : (
          <div>
            {visible.map((p, i) => (
              <ContrastRow
                key={`${p.fg}|${p.bg}`}
                p={p}
                first={i === 0}
                dismissal={contrastDismissal(data.dismissed ?? {}, p.fg, p.bg)}
              />
            ))}
            <ShowMore count={overflow.length} label="failing pairs">
              {overflow.map((p) => (
                <ContrastRow
                  key={`${p.fg}|${p.bg}`}
                  p={p}
                  first={false}
                  dismissal={contrastDismissal(data.dismissed ?? {}, p.fg, p.bg)}
                />
              ))}
            </ShowMore>
          </div>
        )}
      </div>
    </DesignSection>
  );
}

// ── Radii & spacing ──────────────────────────────────────────────────────────

function RadiusChip({
  r,
  previews,
  dismissal,
}: {
  r: PolishdDesignData["radii"][number];
  previews: PreviewFor;
  dismissal?: DesignDismissal;
}) {
  return (
    <Flaggable
      flagged={r.outlier || r.offScale}
      value={{ kind: "radius", value: r.value }}
      label={`${r.value} radius`}
      pages={r.pages}
      previews={previews}
      className="flex flex-col items-center gap-1.5"
      flaggedClassName={`-m-2 rounded-lg p-2 ${FLAGGED_ROW}`}
    >
      <div
        className="h-14 w-14 border-[1.5px] border-accent/70 bg-accent/[0.07]"
        style={{
          borderRadius: r.value === "full" ? "9999px" : r.value.replace(" (mixed)", ""),
        }}
      />
      <div className="mt-0.5 flex items-center gap-1 text-[12px] text-fg-2">
        <span className="font-mono">{r.value}</span>
        <ValueBadges
          outlier={r.outlier}
          offScale={r.offScale}
          example={`rounded-[${r.value.replace(" (mixed)", "")}]`}
          dismissal={dismissal}
        />
      </div>
      <span className="text-[11.5px] tabular-nums text-fg-3" title={declLabel(r) || undefined}>
        ×{r.count.toLocaleString()}
        {r.declarations !== undefined && !r.legacyUses && ` · ${r.declarations.toLocaleString()} decl`}
      </span>
    </Flaggable>
  );
}

function RadiusSection({ data, previews }: { data: PolishdDesignData; previews: PreviewFor }) {
  if (data.radii.length === 0) return null;
  const radii = data.radii.slice(0, 20);
  return (
    <DesignSection
      title="Corner radii"
      tip="— rounding in use on visible boxes and controls. Hover a flagged radius to see where it renders."
    >
      <div className={`${card} overflow-hidden pb-4`}>
        <SectionFlags flags={data.flags} section="radius" />
        <OverflowRow
          label="radii"
          className="px-4 pt-4 sm:px-5"
          rowClassName="flex flex-wrap items-end gap-5"
        >
          {radii.map((r) => (
            <RadiusChip
              key={r.value}
              r={r}
              previews={previews}
              dismissal={radiusDismissal(data.dismissed ?? {}, r.value)}
            />
          ))}
        </OverflowRow>
      </div>
    </DesignSection>
  );
}

function SpacingRow({
  s,
  max,
  previews,
  dismissal,
}: {
  s: PolishdDesignData["spacing"][number];
  max: number;
  previews: PreviewFor;
  dismissal?: DesignDismissal;
}) {
  return (
    <Flaggable
      flagged={s.offScale}
      value={{ kind: "spacing", px: s.px }}
      label={`${s.px}px padding`}
      pages={s.pages}
      previews={previews}
      className="flex items-center gap-3"
      flaggedClassName={`-mx-1.5 rounded-md px-1.5 ${FLAGGED_ROW}`}
    >
      <span className="w-12 shrink-0 text-right font-mono text-[12px] tabular-nums text-fg-2">
        {s.px}px
      </span>
      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-raised">
        <div
          className={`h-full rounded-full ${s.offScale && !dismissal ? "bg-warn/80" : "bg-accent/80"}`}
          style={{ width: `${Math.max((s.px / max) * 100, 2)}%` }}
        />
      </div>
      <span
        className="w-16 shrink-0 text-right text-[12px] tabular-nums text-fg-3"
        title={
          declLabel(s)
            ? `${s.count.toLocaleString()} ${s.count === 1 ? "use" : "uses"} · ${declLabel(s)}`
            : undefined
        }
      >
        ×{s.count.toLocaleString()}
      </span>
      <span className="w-16 shrink-0">
        <ValueBadges offScale={s.offScale} example={`p-[${s.px}px]`} dismissal={dismissal} />
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
    <DesignSection
      title="Spacing"
      tip="— padding values in use, as a scale. Bars are to scale. Hover an off-scale value to see where it renders."
    >
      <div className={`${card} overflow-hidden pb-4`}>
        <SectionFlags flags={data.flags} section="spacing" />
        <div className="space-y-2 px-4 pb-1 pt-5 sm:px-5">
          {visible.map((s) => (
            <SpacingRow
              key={s.px}
              s={s}
              max={max}
              previews={previews}
              dismissal={data.dismissed?.[spacingKey(s.px)]}
            />
          ))}
        </div>
        <ShowMore count={overflow.length} label="padding values">
          <div className="mt-2 space-y-2 px-4 pb-1 sm:px-5">
            {overflow.map((s) => (
              <SpacingRow
                key={s.px}
                s={s}
                max={max}
                previews={previews}
                dismissal={data.dismissed?.[spacingKey(s.px)]}
              />
            ))}
          </div>
        </ShowMore>
      </div>
    </DesignSection>
  );
}

// ── The current build ────────────────────────────────────────────────────────
// Scans are chosen per build (server/design-builds.ts): once every page the
// current build has served is scanned on it, only its scans are merged. Until
// then the tab is honest about the mix, and says which pages would finish it.

/** How many pending pages the callout names before "+N more". */
const PENDING_NAMED = 6;

function BuildStatus({ data }: { data: PolishdDesignData }) {
  const b = data.build;
  if (!b || b.complete || data.pages.length === 0) return null;
  const label = shortBuild(b.build);
  const since = new Date(b.firstSeen).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const named = b.pending.slice(0, PENDING_NAMED);
  const more = b.pending.length - named.length;
  return (
    <Callout
      tone="neutral"
      className="mb-8"
      title={
        b.scanned === 0
          ? `Build ${label} is live, but no page has been scanned on it yet.`
          : `Build ${label} is live; ${b.scanned} of ${b.scanned + b.pending.length} ${
              b.scanned + b.pending.length === 1 ? "page" : "pages"
            } it serves ${b.scanned === 1 ? "has" : "have"} been scanned on it.`
      }
    >
      <p>
        {b.carried > 0
          ? `The metrics below still include the previous build's scan of ${b.carried} ${
              b.carried === 1 ? "page" : "pages"
            }. `
          : ""}
        Once every page this build has served (since {since}) has a scan from it, only its scans
        are used and the older ones drop out.
        {b.pending.length > 0 ? " Still waiting on:" : " Nothing has been viewed on it yet."}
      </p>
      {b.pending.length > 0 && (
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[12px] text-fg-2">
          {named.map((p) => (
            <span key={p}>{p}</span>
          ))}
          {more > 0 && <span className="font-sans text-fg-3">+{more} more</span>}
        </p>
      )}
      <p className="mt-1.5 text-fg-3">
        A page is scanned once per visit after it settles — open each and refresh the metrics.
      </p>
    </Callout>
  );
}

/** The header pill: pages scanned, and on which build when one is known. */
function ScanPill({ data }: { data: PolishdDesignData }) {
  const n = data.pages.length;
  if (n === 0) return <StatusPill tone="neutral">No scans yet</StatusPill>;
  const pages = `${n} ${n === 1 ? "page" : "pages"} scanned`;
  const b = data.build;
  if (!b) return <StatusPill tone="ok">{pages}</StatusPill>;
  if (b.complete) {
    return (
      <StatusPill tone="ok">
        {pages} · <span className="font-mono">{shortBuild(b.build)}</span>
      </StatusPill>
    );
  }
  return (
    <StatusPill tone="warn">
      {pages} · {b.scanned} on <span className="font-mono">{shortBuild(b.build)}</span>
    </StatusPill>
  );
}

// ── Scanned pages ────────────────────────────────────────────────────────────

function PageRow({
  p,
  first,
  current,
}: {
  p: PolishdDesignData["pages"][number];
  first: boolean;
  /** The build currently shipping, when known — a scan from another is marked. */
  current: string | null;
}) {
  const previous = current !== null && p.build !== current;
  return (
    <div
      className={`flex items-center justify-between gap-3 px-4 py-3 sm:px-5 ${first ? "" : divider}`}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate font-mono text-[12.5px] text-fg-2">{p.path}</span>
        {previous && <Badge tone="warn">previous build</Badge>}
      </span>
      <span className="flex shrink-0 items-center gap-1.5 text-[12px] tabular-nums text-fg-3">
        {p.build && (
          <span className="font-mono" title={p.build}>
            {shortBuild(p.build)} ·
          </span>
        )}
        {p.elements.toLocaleString()} {p.elements === 1 ? "element" : "elements"} ·{" "}
        {new Date(p.scannedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
      </span>
    </div>
  );
}

function ScannedPages({ data }: { data: PolishdDesignData }) {
  if (data.pages.length === 0) return null;
  const current = data.build?.build ?? null;
  const visible = data.pages.slice(0, VISIBLE_ROWS);
  const overflow = data.pages.slice(VISIBLE_ROWS);
  return (
    <DesignSection
      title="Scanned pages"
      tip="— the scan each route is measured from, newest first, with the build it was taken on. Once the current build has scanned every page it serves, only its scans are used. The dashboard itself is never scanned."
    >
      <div className={`${card} overflow-hidden`}>
        {visible.map((p, i) => (
          <PageRow key={p.path} p={p} first={i === 0} current={current} />
        ))}
        <ShowMore count={overflow.length} label="pages">
          {overflow.map((p) => (
            <PageRow key={p.path} p={p} first={false} current={current} />
          ))}
        </ShowMore>
      </div>
    </DesignSection>
  );
}

// ── The tab ──────────────────────────────────────────────────────────────────

export interface DesignPanelProps {
  data: PolishdDesignData;
  review: PolishdDesignReview | null;
  reviewStale: boolean;
  settings: PolishdAISettingsPublic;
  snapshots: PolishdSnapshot[];
  /** What Site snapshots can do here — it decides where the section sits. */
  snapshotMode: SnapshotAvailability;
}

export function DesignPanel({
  data,
  review,
  reviewStale,
  settings,
  snapshots,
  snapshotMode,
}: DesignPanelProps) {
  const hasScans = data.pages.length > 0;
  // The same target list a capture is planned from, so a card can tell a value
  // the next capture will look for from one it never will.
  const previews = previewIndex(
    snapshots,
    new Set(designPreviewTargets(data).map((t) => t.key)),
  );
  return (
    <main className="text-fg">
      <SnapshotsProvider initial={snapshots} availability={snapshotMode}>
        <PageHeader
          title="Design review"
          description={
            <>
              Your site&apos;s brand guideline, reverse-engineered from the rendered pages — the
              typography, palette, radii and spacing it actually ships, with anything that breaks
              the system flagged.
            </>
          }
          actions={
            <>
              {hasScans && <BrandKitButton kit={buildBrandKit(data)} />}
              <RefreshMetricsButton />
              <ScanPill data={data} />
            </>
          }
        />

        {!data.ready && (
          <Callout tone="warn" className="mb-8">
            The analytics store isn&apos;t writable in this environment. Run locally or configure a
            database — see the <Code>@polishd/next</Code> DATABASE.md guide.
          </Callout>
        )}

        {/* Which build the metrics describe, while a new one is still being scanned. */}
        <BuildStatus data={data} />

        {data.ready && !hasScans && (
          <div className={`mb-10 ${card}`}>
            <EmptyState>
              No design scans captured yet. Each page measures its own rendered design (fonts,
              colors, radii, spacing) once per visitor session — browse a few pages of the site,
              then refresh the metrics.
            </EmptyState>
          </div>
        )}

        {/* The site as it actually renders — screenshots of every scanned page.
            Here when it can capture; at the bottom of the tab, off, when it can't. */}
        <SnapshotsSlot position="top" />

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
            <TypographySection data={data} previews={previews} />
            <PaletteSection data={data} previews={previews} />
            <ContrastSection data={data} />
            <RadiusSection data={data} previews={previews} />
            <SpacingSection data={data} previews={previews} />
            <ScannedPages data={data} />
          </>
        )}

        <SnapshotsSlot position="bottom" />
      </SnapshotsProvider>
    </main>
  );
}
