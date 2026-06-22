"use client";

/**
 * Buffd — sampled user journeys (client).
 *
 * Renders the sampled sessions as a compact, scannable list of cards. Clicking
 * a card opens a right-side drawer with the full session summary: metadata plus
 * the start-to-finish flow chart of every action. A drawer (rather than a modal
 * or separate page) keeps the dashboard in view while you drill into one
 * session — the standard pattern for session-replay tooling.
 */
import { useEffect, useState } from "react";

import type { JourneyStep, SessionJourney } from "../server/queries";

// ── Design tokens (kept in sync with page.tsx's Vercel aesthetic) ─────────────
const border = "border-[#2e2e2e]";
const card = `border ${border} rounded-lg bg-[#0a0a0a]`;
const divider = `border-t ${border}`;

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

function fmtClock(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function scoreTone(score: number) {
  if (score >= 10) return "text-red-500";
  if (score >= 4) return "text-[#f5a623]";
  return "text-[#0cce6b]";
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
  if (j.jsErrors) parts.push(`${j.jsErrors} ${j.jsErrors === 1 ? "error" : "errors"}`);
  return parts.join(" · ");
}

// ── Flow-chart step row (shared by the drawer) ────────────────────────────────
const STEP_STYLE: Record<
  JourneyStep["type"],
  { dot: string; verb: string; verbTone: string; tag?: { text: string; cls: string } }
> = {
  page_view: { dot: "bg-blue-500", verb: "Viewed", verbTone: "text-blue-400" },
  click: { dot: "bg-[#555]", verb: "Clicked", verbTone: "text-[#bbb]" },
  rage_click: {
    dot: "bg-red-500",
    verb: "Rage-clicked",
    verbTone: "text-red-400",
    tag: { text: "rage", cls: "bg-red-950 text-red-400" },
  },
  dead_click: {
    dot: "bg-[#f5a623]",
    verb: "Dead-clicked",
    verbTone: "text-[#f5a623]",
    tag: { text: "dead", cls: "bg-amber-950 text-amber-400" },
  },
  js_error: {
    dot: "bg-red-600",
    verb: "Error",
    verbTone: "text-red-400",
    tag: { text: "error", cls: "bg-red-950 text-red-400" },
  },
  session_end: { dot: "bg-[#666]", verb: "Left the site", verbTone: "text-[#888]" },
  // Non-action types never reach the flow chart, but the map must be total.
  scroll_depth: { dot: "bg-[#444]", verb: "Scrolled", verbTone: "text-[#888]" },
  viewport: { dot: "bg-[#444]", verb: "Viewport", verbTone: "text-[#888]" },
  web_vital: { dot: "bg-[#444]", verb: "Web vital", verbTone: "text-[#888]" },
  hover: { dot: "bg-purple-500", verb: "Hovered", verbTone: "text-purple-400" },
  component_view: { dot: "bg-purple-400", verb: "Viewed component", verbTone: "text-purple-300" },
  mount: { dot: "bg-purple-400", verb: "Rendered component", verbTone: "text-purple-300" },
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
      <div className="relative flex w-2.5 shrink-0 justify-center">
        <span className={`z-10 mt-[5px] h-2.5 w-2.5 shrink-0 rounded-full ${s.dot}`} />
        {!isLast && <span className="absolute top-[5px] h-full w-px bg-[#2e2e2e]" />}
      </div>
      {/* node */}
      <div className="min-w-0 flex-1 pb-3">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className={`text-[13px] font-medium ${s.verbTone}`}>{s.verb}</span>
          {showPath ? (
            <span className="truncate font-mono text-[12px] text-[#ccc]">{step.path}</span>
          ) : step.label ? (
            <span className="truncate text-[13px] text-white">{step.label}</span>
          ) : null}
          {s.tag && (
            <span
              className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${s.tag.cls}`}
            >
              {s.tag.text}
            </span>
          )}
        </div>
        {step.detail && (
          <div className="mt-0.5 truncate font-mono text-[11px] text-red-400/80">{step.detail}</div>
        )}
        {!showPath && step.type !== "session_end" && prevPath !== step.path && (
          <div className="mt-0.5 font-mono text-[11px] text-[#555]">on {step.path}</div>
        )}
      </div>
    </li>
  );
}

// ── Compact, clickable list card ──────────────────────────────────────────────
function JourneyListCard({
  journey,
  onOpen,
}: {
  journey: SessionJourney;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[#111] sm:gap-4 sm:px-5 sm:py-3.5 ${divider} first:border-t-0`}
    >
      {/* score */}
      <div className="flex w-12 shrink-0 flex-col items-center">
        <span className={`text-[18px] font-semibold tabular-nums leading-none ${scoreTone(journey.score)}`}>
          {journey.score}
        </span>
        <span className="mt-1 text-[9px] uppercase tracking-wider text-[#555]">score</span>
      </div>
      {/* identity + summary */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[13px] text-white">#{journey.id}</span>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
              journey.complete ? "bg-emerald-950 text-emerald-400" : "bg-[#1a1a1a] text-[#777]"
            }`}
          >
            {journey.complete ? "complete" : "partial"}
          </span>
        </div>
        <div className="mt-1 truncate text-[12px] text-[#888]">{summarize(journey)}</div>
      </div>
      {/* metadata */}
      <div className="hidden shrink-0 flex-col items-end gap-0.5 sm:flex">
        <span className="text-[12px] tabular-nums text-[#ccc]">⏱ {fmtDuration(journey.durationMs)}</span>
        <span className="text-[11px] text-[#666]">{deviceLabel(journey.device)}</span>
        <span className="text-[11px] text-[#555]">{fmtClock(journey.startedAt)}</span>
      </div>
      {/* affordance */}
      <span className="shrink-0 text-[#555] transition-colors group-hover:text-[#999]">›</span>
    </button>
  );
}

// ── Right-side detail drawer ──────────────────────────────────────────────────
function MetaCell({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className={`px-4 py-3 ${border} border-t`}>
      <div className="text-[10px] uppercase tracking-[0.08em] text-[#666]">{label}</div>
      <div className={`mt-1 text-[13px] tabular-nums ${tone ?? "text-white"}`}>{value}</div>
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
      {/* backdrop */}
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-black/60 transition-opacity duration-200 ${
          open ? "opacity-100" : "opacity-0"
        }`}
      />
      {/* panel */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Session journey detail"
        className={`absolute right-0 top-0 flex h-full w-full max-w-sm flex-col border-l ${border} bg-[#0a0a0a] shadow-2xl transition-transform duration-200 ease-out sm:max-w-md ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {journey && (
          <>
            {/* header */}
            <div className={`flex items-center gap-3 border-b ${border} px-4 py-4 sm:px-5`}>
              <span className="font-mono text-[14px] font-semibold text-white">#{journey.id}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  journey.complete ? "bg-emerald-950 text-emerald-400" : "bg-[#1a1a1a] text-[#777]"
                }`}
              >
                {journey.complete ? "complete" : "partial"}
              </span>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="ml-auto flex h-7 w-7 items-center justify-center rounded-md border border-[#2e2e2e] text-[#888] transition-colors hover:bg-[#111] hover:text-white"
              >
                ✕
              </button>
            </div>

            {/* scrollable body */}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {/* metadata grid */}
              <div className="grid grid-cols-2">
                <MetaCell label="Recorded" value={fmtClock(journey.startedAt)} />
                <MetaCell label="Duration" value={fmtDuration(journey.durationMs)} />
                <MetaCell label="Device" value={deviceLabel(journey.device)} />
                <MetaCell
                  label="Pages"
                  value={`${journey.pages} ${journey.pages === 1 ? "page" : "pages"}`}
                />
                <MetaCell
                  label="Buffd score"
                  value={String(journey.score)}
                  tone={scoreTone(journey.score)}
                />
                <MetaCell
                  label="Frustration"
                  value={
                    journey.rageClicks + journey.deadClicks + journey.jsErrors === 0
                      ? "none"
                      : [
                          journey.rageClicks ? `${journey.rageClicks} rage` : null,
                          journey.deadClicks ? `${journey.deadClicks} dead` : null,
                          journey.jsErrors ? `${journey.jsErrors} err` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")
                  }
                  tone={
                    journey.rageClicks + journey.deadClicks + journey.jsErrors > 0
                      ? "text-[#f5a623]"
                      : "text-[#0cce6b]"
                  }
                />
              </div>

              {/* flow chart */}
              <div className={`border-t ${border} px-4 py-4 sm:px-5`}>
                <div className="mb-3 text-[10px] uppercase tracking-[0.08em] text-[#666]">
                  Flow — {journey.steps.length} actions
                </div>
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
                      <div className="flex w-2.5 shrink-0 justify-center">
                        <span className="mt-[5px] h-2.5 w-2.5 rounded-full bg-[#333]" />
                      </div>
                      <span className="text-[12px] italic text-[#555]">
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
        <p className="px-5 py-8 text-center text-[13px] text-[#555]">
          No complete sessions captured yet — browse the site (try a few rage and dead clicks) then
          refresh.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className={card}>
        {journeys.map((j) => (
          <JourneyListCard key={j.id} journey={j} onOpen={() => setSelected(j)} />
        ))}
      </div>
      <JourneyDrawer journey={selected} onClose={() => setSelected(null)} />
    </>
  );
}
