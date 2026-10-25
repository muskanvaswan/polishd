"use client";

/**
 * Polishd — sampled user journeys (client).
 *
 * Renders the sampled sessions as a compact, scannable list of cards. Clicking
 * a card opens a right-side drawer with the full session summary: metadata plus
 * the start-to-finish flow chart of every action. A drawer (rather than a modal
 * or separate page) keeps the dashboard in view while you drill into one
 * session — the standard pattern for session-replay tooling.
 */
import { useEffect, useState, useSyncExternalStore } from "react";

import type { JourneyStep, SessionJourney } from "../server/queries";
import {
  Badge,
  ChevronRightIcon,
  ClockIcon,
  EmptyState,
  XIcon,
  card,
  divider,
  eyebrowCls,
  iconBtn,
  labelCls,
  toneSoft,
  toneText,
  type Tone,
} from "./ui";

const DEVICE_META: Record<string, { label: string }> = {
  mobile: { label: "Mobile" },
  tablet: { label: "Tablet" },
  desktop: { label: "Desktop" },
};

// ── Formatting helpers ────────────────────────────────────────────────────────
function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem ? `${m}m ${rem}s` : `${m}m`;
}

/**
 * "Oct 24, 02:45 PM". `local` formats in the viewer's own locale and timezone;
 * without it the result is pinned to en-US/UTC, the same on every machine.
 */
function fmtClock(ts: number, local: boolean): string {
  return new Date(ts).toLocaleString(local ? undefined : "en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...(local ? {} : { timeZone: "UTC", timeZoneName: "short" }),
  });
}

const subscribeNothing = () => () => {};

/**
 * A timestamp in the viewer's clock, safe to server-render. The server can't
 * know the viewer's timezone or locale, so formatting locally during hydration
 * produced different text on each side — React's hydration error #418 for
 * every viewer outside the server's timezone. The server render and hydration
 * both show the pinned UTC form; the local time swaps in right after.
 */
function LocalClock({ ts }: { ts: number }) {
  const hydrated = useSyncExternalStore(subscribeNothing, () => true, () => false);
  return <time dateTime={new Date(ts).toISOString()}>{fmtClock(ts, hydrated)}</time>;
}

function scoreTone(score: number): Tone {
  if (score >= 10) return "bad";
  if (score >= 4) return "warn";
  return "ok";
}

function deviceLabel(device: SessionJourney["device"]): string {
  if (!device.category) return "Unknown device";
  const name = DEVICE_META[device.category]?.label ?? device.category;
  const size = device.width ? ` · ${device.width}×${device.height ?? "?"}` : "";
  const dpr = device.dpr && device.dpr !== 1 ? ` @${device.dpr}x` : "";
  return `${name}${size}${dpr}`;
}

/** A one-line plain-English gist of the session, shown on the card. */
function summarize(j: SessionJourney): string {
  const parts: string[] = [];
  parts.push(`${j.pages} ${j.pages === 1 ? "page" : "pages"}`);
  const actions = j.steps.filter(
    (s) => s.type === "click" || s.type === "rage_click" || s.type === "dead_click",
  ).length;
  if (actions) parts.push(`${actions} ${actions === 1 ? "interaction" : "interactions"}`);
  if (j.rageClicks) parts.push(`${j.rageClicks} rage`);
  if (j.deadClicks) parts.push(`${j.deadClicks} dead`);
  return parts.join(" · ");
}

// ── Flow-chart step row (shared by the drawer) ────────────────────────────────
const STEP_STYLE: Record<
  JourneyStep["type"],
  { dot: string; verb: string; verbTone: string; tag?: { text: string; tone: Tone } }
> = {
  page_view: { dot: "bg-accent", verb: "Viewed", verbTone: "text-accent" },
  click: { dot: "bg-fg-3", verb: "Clicked", verbTone: "text-fg-2" },
  rage_click: {
    dot: "bg-bad",
    verb: "Rage-clicked",
    verbTone: "text-bad",
    tag: { text: "rage", tone: "bad" },
  },
  dead_click: {
    dot: "bg-warn",
    verb: "Dead-clicked",
    verbTone: "text-warn",
    tag: { text: "dead", tone: "warn" },
  },
  session_end: { dot: "bg-fg-4", verb: "Left the site", verbTone: "text-fg-3" },
  // Non-action types never reach the flow chart, but the map must be total.
  text_click: { dot: "bg-fg-4", verb: "Clicked text", verbTone: "text-fg-3" },
  scroll_depth: { dot: "bg-fg-4", verb: "Scrolled", verbTone: "text-fg-3" },
  viewport: { dot: "bg-fg-4", verb: "Viewport", verbTone: "text-fg-3" },
  web_vital: { dot: "bg-fg-4", verb: "Web vital", verbTone: "text-fg-3" },
  hover: { dot: "bg-violet", verb: "Hovered", verbTone: "text-violet" },
  component_view: { dot: "bg-violet", verb: "Viewed component", verbTone: "text-violet" },
  mount: { dot: "bg-violet", verb: "Rendered component", verbTone: "text-violet" },
  design_scan: { dot: "bg-fg-4", verb: "Design scan", verbTone: "text-fg-3" },
  install_state: { dot: "bg-fg-4", verb: "Install state", verbTone: "text-fg-3" },
};

function JourneyStepRow({
  step,
  isLast,
  prevPath,
}: {
  step: JourneyStep;
  isLast: boolean;
  prevPath: string | null;
}) {
  const s = STEP_STYLE[step.type];
  const showPath = step.type === "page_view";
  return (
    <li className="relative flex gap-3">
      {/* rail: dot + connector down to the next node */}
      <div className="relative flex w-3 shrink-0 justify-center">
        <span
          className={`z-10 mt-[5px] h-2.5 w-2.5 shrink-0 rounded-full ring-[3px] ring-surface ${s.dot}`}
        />
        {!isLast && <span className="absolute top-[7px] h-full w-px bg-line-strong" />}
      </div>
      {/* node */}
      <div className="min-w-0 flex-1 pb-3.5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className={`text-[13px] font-medium ${s.verbTone}`}>{s.verb}</span>
          {showPath ? (
            <span className="truncate font-mono text-[12px] text-fg-2">{step.path}</span>
          ) : step.label ? (
            <span className="truncate text-[13px] text-fg">{step.label}</span>
          ) : null}
          {s.tag && <Badge tone={s.tag.tone}>{s.tag.text}</Badge>}
        </div>
        {!showPath && step.type !== "session_end" && prevPath !== step.path && (
          <div className="mt-0.5 font-mono text-[11.5px] text-fg-3">on {step.path}</div>
        )}
      </div>
    </li>
  );
}

// ── Compact, clickable list card ──────────────────────────────────────────────
function StatusBadge({ complete }: { complete: boolean }) {
  return <Badge tone={complete ? "ok" : "neutral"}>{complete ? "complete" : "partial"}</Badge>;
}

function JourneyListCard({
  journey,
  onOpen,
}: {
  journey: SessionJourney;
  onOpen: () => void;
}) {
  const tone = scoreTone(journey.score);
  return (
    <button
      type="button"
      data-component="journey-open"
      onClick={onOpen}
      className={`group flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-raised/50 sm:gap-4 sm:px-5 ${divider} first:border-t-0`}
    >
      {/* score */}
      <div
        className={`flex h-11 w-12 shrink-0 flex-col items-center justify-center rounded-lg ring-1 ring-inset ${toneSoft[tone]}`}
        title="Polishd score"
      >
        <span className="text-[16px] font-semibold leading-none tabular-nums">{journey.score}</span>
        <span className="mt-1 text-[10px] font-medium uppercase tracking-[0.08em]">
          score
        </span>
      </div>
      {/* identity + summary */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[13px] font-medium text-fg">#{journey.id}</span>
          <StatusBadge complete={journey.complete} />
        </div>
        <div className="mt-1 truncate text-[12.5px] text-fg-3">{summarize(journey)}</div>
      </div>
      {/* metadata */}
      <div className="hidden shrink-0 flex-col items-end gap-0.5 sm:flex">
        <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium tabular-nums text-fg-2">
          <span className="text-fg-3">
            <ClockIcon size={12} />
          </span>
          {fmtDuration(journey.durationMs)}
        </span>
        <span className="text-[12px] text-fg-3">{deviceLabel(journey.device)}</span>
        <span className="text-[12px] tabular-nums text-fg-3">
          <LocalClock ts={journey.startedAt} />
        </span>
      </div>
      {/* affordance */}
      <span className="shrink-0 text-fg-3 transition-[color,transform] group-hover:translate-x-0.5 group-hover:text-fg-2">
        <ChevronRightIcon size={15} />
      </span>
    </button>
  );
}

// ── Right-side detail drawer ──────────────────────────────────────────────────
function MetaCell({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="border-t border-line px-4 py-3 odd:border-r sm:px-5">
      <div className={labelCls}>{label}</div>
      <div className={`mt-1 text-[13px] font-medium tabular-nums ${tone ?? "text-fg"}`}>{value}</div>
    </div>
  );
}

function JourneyDrawer({
  journey,
  onClose,
}: {
  journey: SessionJourney | null;
  onClose: () => void;
}) {
  // Esc to close + lock background scroll while the drawer is open.
  useEffect(() => {
    if (!journey) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [journey, onClose]);

  const open = journey !== null;

  // Track the current page so action nodes only annotate path on change.
  let lastPath: string | null = null;

  return (
    <div className={`fixed inset-0 z-50 ${open ? "" : "pointer-events-none"}`} aria-hidden={!open}>
      {/* backdrop — a button, because clicking it closes the drawer. As a
          plain div with a React onClick, the click capture can't see the
          handler and logs every close as a dead click. Hidden from assistive
          tech and the tab order; Escape and the ✕ button are the ways out. */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        onClick={onClose}
        className={`absolute inset-0 cursor-default bg-black/60 backdrop-blur-[2px] transition-opacity duration-200 ${
          open ? "opacity-100" : "opacity-0"
        }`}
      />
      {/* panel */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Session journey detail"
        className={`absolute right-0 top-0 flex h-full w-full max-w-sm flex-col border-l border-line-strong bg-surface shadow-pop transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] sm:max-w-md ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {journey && (
          <>
            {/* header */}
            <div className="flex items-center gap-3 border-b border-line px-4 py-3.5 sm:px-5">
              <div className="min-w-0">
                <div className={eyebrowCls}>Session</div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="font-mono text-[15px] font-semibold text-fg">#{journey.id}</span>
                  <StatusBadge complete={journey.complete} />
                </div>
              </div>
              <button
                type="button"
                data-component="journey-close"
                onClick={onClose}
                aria-label="Close"
                className={`${iconBtn} ml-auto`}
              >
                <XIcon size={15} />
              </button>
            </div>

            {/* scrollable body */}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {/* metadata grid */}
              <div className="-mt-px grid grid-cols-2">
                <MetaCell label="Recorded" value={fmtClock(journey.startedAt, true)} />
                <MetaCell label="Duration" value={fmtDuration(journey.durationMs)} />
                <MetaCell label="Device" value={deviceLabel(journey.device)} />
                <MetaCell
                  label="Pages"
                  value={`${journey.pages} ${journey.pages === 1 ? "page" : "pages"}`}
                />
                <MetaCell
                  label="Polishd score"
                  value={String(journey.score)}
                  tone={toneText[scoreTone(journey.score)]}
                />
                <MetaCell
                  label="Frustration"
                  value={
                    journey.rageClicks + journey.deadClicks === 0
                      ? "none"
                      : [
                          journey.rageClicks ? `${journey.rageClicks} rage` : null,
                          journey.deadClicks ? `${journey.deadClicks} dead` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")
                  }
                  tone={
                    journey.rageClicks + journey.deadClicks > 0
                      ? "text-warn"
                      : "text-ok"
                  }
                />
              </div>

              {/* flow chart */}
              <div className="border-t border-line px-4 py-5 sm:px-5">
                <div className={`mb-4 ${eyebrowCls}`}>Flow — {journey.steps.length} actions</div>
                <ol>
                  {journey.steps.map((step, i) => {
                    const prevPath = lastPath;
                    if (step.type === "page_view") lastPath = step.path;
                    return (
                      <JourneyStepRow
                        key={i}
                        step={step}
                        isLast={i === journey.steps.length - 1 && !journey.truncated}
                        prevPath={prevPath}
                      />
                    );
                  })}
                  {journey.truncated && (
                    <li className="flex gap-3">
                      <div className="flex w-3 shrink-0 justify-center">
                        <span className="mt-[5px] h-2.5 w-2.5 rounded-full border border-dashed border-fg-4" />
                      </div>
                      <span className="text-[12px] italic text-fg-3">
                        … journey continues (more actions captured)
                      </span>
                    </li>
                  )}
                </ol>
              </div>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

// ── Exported list + drawer ────────────────────────────────────────────────────
export default function JourneyList({ journeys }: { journeys: SessionJourney[] }) {
  const [selected, setSelected] = useState<SessionJourney | null>(null);

  if (journeys.length === 0) {
    return (
      <div className={card}>
        <EmptyState>
          No complete sessions captured yet — browse the site (try a few rage and dead clicks) then
          refresh.
        </EmptyState>
      </div>
    );
  }

  return (
    <>
      <div className={`${card} overflow-hidden`}>
        {journeys.map((j) => (
          <JourneyListCard key={j.id} journey={j} onOpen={() => setSelected(j)} />
        ))}
      </div>
      <JourneyDrawer journey={selected} onClose={() => setSelected(null)} />
    </>
  );
}
