"use client";

/**
 * Polishd — the Design tab's Site snapshots section.
 *
 * Renders the site's captured screenshots as a device/theme-filterable grid,
 * with a button that shoots a fresh set. A capture runs from this page (see
 * snapshot-capture.ts): each shot appears in a live grid as it arrives, and
 * the finished snapshot reuses those images rather than fetching them again.
 * Older snapshots' images are fetched lazily per tile through a server action
 * (they live on the server's disk or in Vercel Blob — either way the
 * dashboard never hands out a direct URL), and a clicked tile expands into a
 * full-height lightbox.
 *
 * `ShotTile` and `ShotLightbox` are exported for the Overview's gallery
 * (snapshot-gallery.tsx), which tiles the newest snapshot with the same
 * pieces and none of the controls.
 *
 * Where the section sits depends on what it can do here (`SnapshotMode`):
 * locally, or in production once the owner has allowed Polishd's screenshot
 * service and images have somewhere to go, it's near the top of the tab. In
 * production without one of those — or once a capture finds the service
 * can't be used from here (CSP, rate limit, outage, a site it can't reach) —
 * it moves to the bottom, turned off, saying why — and stays there, across
 * reloads, until a capture gets through again. The tab is server-rendered,
 * so the section lives in two slots and a provider holds its state; moving
 * between them never loses a capture in flight. The provider also asks the
 * consent question, once, in a dialog — when Capture is first pressed in
 * production, not before.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";

import type { SnapshotMode, StoredCaptureBlock } from "../capture/protocol";
import type { PolishdSnapshot, PolishdSnapshotShot, SnapshotAvailability } from "../server/snapshots";
import {
  getSnapshotImageAction,
  setSnapshotBlockAction,
  setSnapshotServiceConsentAction,
} from "./snapshot-actions";
import { runSnapshotCapture, type LiveShot } from "./snapshot-capture";
import { disabledMessage } from "./snapshot-messages";
import {
  Badge,
  Callout,
  RefreshIcon,
  XIcon,
  card,
  cardHeader,
  cardTitleCls,
  ghostBtn,
  primaryBtn,
  relTime,
  textLink,
} from "./ui";

const shotKey = (s: { route: string; device: string; theme: string }) =>
  `${s.route}|${s.device}|${s.theme}`;

const DEVICES = ["desktop", "phone"] as const;
const THEMES = ["light", "dark"] as const;

function TogglePills<T extends string>({
  options,
  value,
  onChange,
  component,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  /** `data-component` name for dashboard telemetry — see the card below. */
  component: string;
}) {
  return (
    <span className="flex items-center gap-0.5 rounded-lg border border-line bg-sunken p-0.5">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          data-component={component}
          onClick={() => onChange(opt)}
          aria-pressed={opt === value}
          className={`inline-flex h-7 items-center rounded-md px-2.5 text-[12px] font-medium capitalize transition-colors ${
            opt === value
              ? "bg-raised text-fg shadow-[inset_0_0_0_1px_var(--pd-line-strong)]"
              : "text-fg-3 hover:text-fg"
          }`}
        >
          {opt}
        </button>
      ))}
    </span>
  );
}

/** What a clicked tile hands the lightbox. */
export interface ShotZoom {
  src: string;
  route: string;
  /** Phone shots open narrower than desktop ones. */
  device: string;
}

/**
 * One screenshot tile. Fetches its image the first time it renders, unless
 * the capture that just ran already has it in hand. The Design tab captions
 * it underneath; the Overview's gallery lays the caption over the picture so
 * the tile itself can be the grid cell.
 */
export function ShotTile({
  snapshotId,
  shot,
  known,
  onZoom,
  frameClassName = "aspect-[4/5] w-full",
  caption = "below",
  component = "design-snapshot-open",
}: {
  snapshotId: string;
  shot: PolishdSnapshotShot;
  known?: string;
  onZoom: (zoom: ShotZoom) => void;
  /** The tile's size and placement — its aspect ratio, and any grid span. */
  frameClassName?: string;
  caption?: "below" | "overlay";
  /** `data-component` name for dashboard telemetry. */
  component?: string;
}) {
  const [src, setSrc] = useState<string | null>(known ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    if (known) {
      setSrc(known);
      return;
    }
    setSrc(null);
    setFailed(false);
    getSnapshotImageAction(snapshotId, shot.file)
      .then((res) => {
        if (!alive) return;
        if (res.ok) setSrc(res.dataUrl);
        else setFailed(true);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [snapshotId, shot.file, known]);

  const frame = (
    <button
      type="button"
      data-component={component}
      onClick={() => src && onZoom({ src, route: shot.route, device: shot.device })}
      disabled={!src}
      title={src ? `${shot.route} — click to enlarge` : shot.route}
      className={`relative block ${frameClassName} overflow-hidden rounded-lg border border-line bg-canvas transition-[border-color,transform] hover:-translate-y-0.5 hover:border-fg-4 disabled:cursor-default disabled:hover:translate-y-0 disabled:hover:border-line`}
    >
      {src ? (
        // Full-page shots are tall; the tile shows the top of the page and
        // the lightbox shows the rest.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={`${shot.route} — ${shot.device}, ${shot.theme}`}
          className="h-full w-full object-cover object-top"
        />
      ) : (
        <span
          className={`flex h-full items-center justify-center px-2 text-center text-[12px] text-fg-3 ${failed ? "" : "motion-safe:animate-pulse"}`}
        >
          {failed ? "image missing" : "loading…"}
        </span>
      )}
      {caption === "overlay" && (
        <span className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-1 bg-linear-to-t from-black/80 to-transparent px-2.5 pb-2 pt-8 text-left font-mono text-[11px] leading-none text-white/90">
          <span className="truncate">{shot.route}</span>
          <span className="truncate text-white/55">
            {shot.device} · {shot.theme}
          </span>
        </span>
      )}
    </button>
  );
  if (caption === "overlay") return frame;
  return (
    <figure className="min-w-0">
      {frame}
      <figcaption className="mt-2 truncate font-mono text-[12px] text-fg-2">
        {shot.route}
      </figcaption>
    </figure>
  );
}

// ── State, shared by both slots ──────────────────────────────────────────────

interface SnapshotsState {
  snapshots: PolishdSnapshot[];
  availability: SnapshotAvailability;
  /** Set while the last capture's finding stands: the service can't be used from here. */
  block: StoredCaptureBlock | null;
  error: string | null;
  capturing: boolean;
  /**
   * False until this page is interactive. The section is server-rendered and
   * a click on a button that isn't hydrated yet does nothing at all, so the
   * buttons stay disabled until they can actually respond.
   */
  ready: boolean;
  progress: { done: number; total: number } | null;
  live: LiveShot[];
  /** Images the last capture already holds, by snapshot id then cell. */
  fresh: Map<string, Map<string, string>>;
  capture: () => void;
  openConsent: () => void;
  /** Withdraw consent: production captures stop using the service. */
  turnOff: () => void;
  /** True while the aesthetic review runs its own capture — one capture at a time. */
  reviewCapturing: boolean;
  setReviewCapturing: (on: boolean) => void;
  /** A block another capture found, so the section turns off without a reload. */
  noteBlock: (block: StoredCaptureBlock) => void;
}

const SnapshotsContext = createContext<SnapshotsState | null>(null);

function useSnapshots(): SnapshotsState {
  const ctx = useContext(SnapshotsContext);
  if (!ctx) throw new Error("Site snapshots rendered outside their provider");
  return ctx;
}

/** The section's state where there is a provider (the Design tab), null elsewhere (the Overview). */
export function useSnapshotsOptional(): SnapshotsState | null {
  return useContext(SnapshotsContext);
}

/** True when the section is off — it then renders in the bottom slot. */
function isOff(mode: SnapshotMode, block: StoredCaptureBlock | null): boolean {
  return mode.kind === "disabled" || (mode.kind === "service" && block !== null);
}

function serviceHost(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export interface SnapshotsProviderProps {
  initial: PolishdSnapshot[];
  /** What the section can do here, decided server-side at render. */
  availability: SnapshotAvailability;
  children: ReactNode;
}

export function SnapshotsProvider({ initial, availability: initialAvailability, children }: SnapshotsProviderProps) {
  const [snapshots, setSnapshots] = useState<PolishdSnapshot[]>(initial);
  const [availability, setAvailability] = useState(initialAvailability);
  const [block, setBlock] = useState<StoredCaptureBlock | null>(initialAvailability.block);
  const [error, setError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [reviewCapturing, setReviewCapturing] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [live, setLive] = useState<LiveShot[]>([]);
  // The dialog only ever opens from a click — Capture, or "Review and
  // allow" — so it can't be answered before the page is interactive.
  const [consentOpen, setConsentOpen] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState(false);
  const fresh = useRef(new Map<string, Map<string, string>>());
  /** Set when Capture opened the dialog: allowing it carries straight on into the capture. */
  const captureAfterConsent = useRef(false);
  const captureRef = useRef<() => void>(() => {});
  const router = useRouter();

  const capture = useCallback(() => {
    if (capturing || reviewCapturing) return;
    // A standing block stays put while a retry runs: the section only comes
    // back up once a capture actually gets through.
    const blocked = block !== null;
    setError(null);
    setLive([]);
    setCapturing(true);
    const arrived = new Map<string, string>();
    // Every await is caught: a rejected action must land in the error box,
    // never in the error boundary (which would take the whole tab down).
    runSnapshotCapture({
      onPlan: (plan) => setProgress({ done: 0, total: plan.routes.length * plan.renderings.length }),
      onShot: (shot) => {
        if (shot.src) arrived.set(shotKey(shot), shot.src);
        setLive((prev) => [...prev, shot]);
      },
      onProgress: (done, total) => setProgress({ done, total }),
    })
      .then(async (outcome) => {
        if (outcome.consentRequired) {
          // The server is the judge (this page's idea of the mode may be
          // stale): ask now, and capture once it's allowed.
          captureAfterConsent.current = true;
          setConsentError(null);
          setConsentOpen(true);
          return;
        }
        if (outcome.snapshot) {
          const snapshot = outcome.snapshot;
          fresh.current.set(snapshot.id, arrived);
          setSnapshots((prev) => [snapshot, ...prev]);
          // The tab's value cards are server-rendered from the snapshots;
          // refresh them so the new pictures show without a reload.
          router.refresh();
        }
        setError(outcome.error);
        if (outcome.block) {
          // Remembered server-side, so a reload keeps the section down too.
          const saved = await setSnapshotBlockAction(outcome.block).catch(() => null);
          setBlock(saved?.ok && saved.block ? saved.block : { ...outcome.block, at: Date.now() });
        } else if (outcome.snapshot && blocked) {
          await setSnapshotBlockAction(null).catch(() => null);
          setBlock(null);
        }
      })
      .catch(() =>
        setError(
          "The capture failed before a result came back — your host's function " +
            "logs will name the exact failure.",
        ),
      )
      .finally(() => {
        setCapturing(false);
        setProgress(null);
        setLive([]);
      });
  }, [capturing, reviewCapturing, block, router]);
  captureRef.current = capture;

  const decide = useCallback((allow: boolean) => {
    setDeciding(true);
    setConsentError(null);
    setSnapshotServiceConsentAction(allow)
      .then((res) => {
        if (!res.ok) {
          // Keep the dialog open: closing it would look like the choice stuck.
          setConsentError(res.message);
          return;
        }
        setAvailability({
          mode: res.mode,
          storageIssue: res.storageIssue,
          serviceUrl: res.serviceUrl,
          block: res.block,
        });
        setBlock(res.block);
        setError(null);
        setConsentOpen(false);
        const go = allow && captureAfterConsent.current && res.mode.kind === "service";
        captureAfterConsent.current = false;
        if (go) captureRef.current();
      })
      .catch(() => setConsentError("Couldn't record the choice — try again."))
      .finally(() => setDeciding(false));
  }, []);

  const state: SnapshotsState = {
    snapshots,
    availability,
    block,
    error,
    capturing,
    ready,
    progress,
    live,
    fresh: fresh.current,
    capture,
    openConsent: () => {
      captureAfterConsent.current = false;
      setConsentError(null);
      setConsentOpen(true);
    },
    turnOff: () => decide(false),
    reviewCapturing,
    setReviewCapturing,
    noteBlock: setBlock,
  };

  const host = serviceHost(availability.serviceUrl);
  return (
    <SnapshotsContext.Provider value={state}>
      {children}
      {consentOpen && host && (
        <ConsentDialog host={host} busy={deciding} error={consentError} onDecide={decide} />
      )}
    </SnapshotsContext.Provider>
  );
}

/**
 * Where the section may render. The tab places one near the top and one at
 * the bottom; only the slot matching the section's state shows it.
 */
export function SnapshotsSlot({ position }: { position: "top" | "bottom" }) {
  const { availability, block } = useSnapshots();
  const off = isOff(availability.mode, block);
  return off === (position === "bottom") ? <SnapshotsCard /> : null;
}

// ── The consent dialog ───────────────────────────────────────────────────────

/**
 * Asked once per install, in production: may site snapshots call Polishd's
 * screenshot service? It says plainly what the call is, what the service sees
 * and doesn't, and why it's harmless. Declining (or dismissing) turns the
 * section off; it can be reconsidered from there.
 */
function ConsentDialog({
  host,
  busy,
  error,
  onDecide,
}: {
  host: string;
  busy: boolean;
  error: string | null;
  onDecide: (allow: boolean) => void;
}) {
  const allowRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    allowRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onDecide(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onDecide]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-[2px]">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="polishd-snapshot-consent-title"
        data-component="design-snapshot-consent"
        className="w-full max-w-lg rounded-2xl border border-line-strong bg-surface p-5 shadow-pop sm:p-6"
      >
        <h2 id="polishd-snapshot-consent-title" className="text-[16px] font-semibold text-fg">
          Allow site snapshots to use Polishd&rsquo;s screenshot service?
        </h2>
        <p className="mt-3 text-[13px] leading-relaxed text-fg-2">
          In production, your server runs no browser, so screenshots of your pages are taken by
          Polishd&rsquo;s screenshot service at <span className="font-mono text-fg">{host}</span>.
          When you capture, this dashboard sends it the path of each page; the service opens that
          page on your site the way any visitor would and sends the picture back here, and the
          dashboard saves it to your own storage.
        </p>
        <ul className="mt-4 space-y-2 rounded-xl border border-line bg-sunken p-3.5 text-[12.5px] leading-relaxed text-fg-3">
          <li>
            <span className="font-medium text-fg">What it sees:</span> the paths being shot, and what those
            pages show the public.
          </li>
          <li>
            <span className="font-medium text-fg">What it never gets:</span> your cookies or logins, your
            analytics data, or your storage credentials.
          </li>
          <li>
            <span className="font-medium text-fg">Why it&rsquo;s harmless:</span> it only loads public pages,
            read-only, a few at a time and rate-limited; it keeps no images or logs of them; and its
            visits are never counted in your analytics.
          </li>
        </ul>
        <p className="mt-3 text-[12px] text-fg-3">
          Allowing it starts this capture. You can turn it off later from the Site snapshots
          section.
        </p>
        {error && (
          <p role="alert" className="mt-3 text-[12px] text-bad">
            {error}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            data-component="design-snapshot-consent-decline"
            disabled={busy}
            onClick={() => onDecide(false)}
            className={ghostBtn}
          >
            Not now
          </button>
          <button
            ref={allowRef}
            type="button"
            data-component="design-snapshot-consent-allow"
            disabled={busy}
            onClick={() => onDecide(true)}
            className={primaryBtn}
          >
            Allow
          </button>
        </div>
      </div>
    </div>
  );
}

// ── The section ──────────────────────────────────────────────────────────────

/**
 * Why the section is off, and what can be done about it from here. A mode
 * that's off (no storage, not allowed) outranks a capture's block: retrying
 * can't help until that's settled.
 */
function offState(
  availability: SnapshotAvailability,
  block: StoredCaptureBlock | null,
): { message: string; action: "reconsider" | "retry" | null } | null {
  const { mode } = availability;
  if (mode.kind === "disabled") {
    return {
      message: disabledMessage(mode.reason, availability.storageIssue),
      action: mode.reason === "declined" ? "reconsider" : null,
    };
  }
  if (mode.kind === "service" && block) {
    return { message: `Last capture, ${relTime(block.at)}: ${block.message}`, action: "retry" };
  }
  return null;
}

function SnapshotsCard() {
  const {
    snapshots,
    availability,
    block,
    error,
    capturing,
    progress,
    live,
    fresh,
    capture,
    openConsent,
    turnOff,
    ready,
    reviewCapturing,
  } = useSnapshots();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [device, setDevice] = useState<(typeof DEVICES)[number]>("desktop");
  const [theme, setTheme] = useState<(typeof THEMES)[number]>("light");
  const [zoom, setZoom] = useState<ShotZoom | null>(null);

  // A new capture selects itself.
  const newest = snapshots[0]?.id ?? null;
  useEffect(() => setSelectedId(null), [newest]);

  const { mode } = availability;
  const off = offState(availability, block);
  const needsConsent = mode.kind === "consent";
  const selected = snapshots.find((s) => s.id === selectedId) ?? snapshots[0] ?? null;
  // A site with no dark mode has its identical dark shots dropped at capture
  // time — hide the toggle rather than offering an empty view.
  const effectiveTheme = selected?.noDarkMode ? "light" : theme;

  const shots = selected
    ? selected.shots.filter(
        (s) => s.device === device && s.theme === effectiveTheme && s.file.length > 0,
      )
    : [];
  const skipped = selected
    ? selected.shots.filter((s) => s.device === device && s.theme === effectiveTheme && !s.file)
    : [];

  const captureButton = (
    <button
      type="button"
      data-component="design-snapshot-capture"
      onClick={capture}
      disabled={!ready || capturing || reviewCapturing || (off !== null && off.action !== "retry")}
      title={off?.message ?? "Screenshot every scanned page — phone and desktop, light and dark"}
      className={primaryBtn}
    >
      <span className="flex items-center gap-1.5">
        <RefreshIcon spinning={capturing} />
        {capturing
          ? progress && progress.total > 0
            ? `Shooting ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`
            : "Shooting pages…"
          : off?.action === "retry"
            ? "Try again"
            : selected
              ? "Capture again"
              : "Capture snapshot"}
      </span>
    </button>
  );

  return (
    // The data-component names here feed polishd's own dashboard telemetry:
    // clicks group under these on the collecting side, so "does anyone shoot
    // a second snapshot?" is answerable. Inert for host apps.
    <section
      data-component="design-snapshots"
      data-state={off ? "off" : mode.kind}
      className={`mb-10 ${card} overflow-hidden`}
    >
      <div className={`${cardHeader} flex-wrap`}>
        <div className="flex items-center gap-2.5">
          <span className={cardTitleCls}>Site snapshots</span>
          {off && <Badge>Off</Badge>}
          {selected && !off && (
            <span className="hidden sm:flex">
              <Badge mono>{selected.origin}</Badge>
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {selected && (
            <>
              <TogglePills
                options={DEVICES}
                value={device}
                onChange={setDevice}
                component="design-snapshot-device"
              />
              {!selected.noDarkMode && (
                <TogglePills
                  options={THEMES}
                  value={theme}
                  onChange={setTheme}
                  component="design-snapshot-theme"
                />
              )}
              {snapshots.length > 1 && (
                <select
                  data-component="design-snapshot-history"
                  value={selected.id}
                  onChange={(e) => setSelectedId(e.target.value)}
                  aria-label="Snapshot"
                  className="h-8 rounded-lg border border-line-strong bg-raised px-2 text-[12px] text-fg-2 transition-colors hover:border-fg-4 focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent/20"
                >
                  {snapshots.map((s) => (
                    <option key={s.id} value={s.id}>
                      {relTime(s.capturedAt)}
                    </option>
                  ))}
                </select>
              )}
            </>
          )}
          {off?.action === "reconsider" ? (
            <button
              type="button"
              data-component="design-snapshot-consent-open"
              onClick={openConsent}
              disabled={!ready}
              className={primaryBtn}
            >
              Review and allow…
            </button>
          ) : (
            captureButton
          )}
        </div>
      </div>

      <div className="px-4 py-5 sm:px-5">
        {off && (
          <div data-component="design-snapshot-off-reason" className="mb-4">
            <Callout tone="neutral">{off.message}</Callout>
          </div>
        )}
        {error && (
          <Callout tone="bad" className="mb-4">
            {error}
          </Callout>
        )}
        {capturing && (
          <p className="mb-4 text-[12.5px] text-fg-2">
            Shooting every scanned page at two sizes in two themes
            {mode.kind === "service"
              ? " with Polishd's screenshot service"
              : mode.kind === "local"
                ? " with a browser on this machine"
                : ""}{" "}
            — this can take a minute. Keep this tab open.
          </p>
        )}
        {capturing && live.length > 0 && (
          <div
            data-component="design-snapshot-live"
            className="mb-5 grid grid-cols-3 gap-3 sm:grid-cols-6 lg:grid-cols-8"
          >
            {live.map((shot) => (
              <figure key={shotKey(shot)} className="min-w-0">
                {shot.src ? (
                  <button
                    type="button"
                    data-component="design-snapshot-live-open"
                    onClick={() => setZoom({ src: shot.src!, route: shot.route, device: shot.device })}
                    title={`${shot.route} — click to enlarge`}
                    className="relative block aspect-[4/5] w-full overflow-hidden rounded-lg border border-line bg-canvas transition-[border-color] hover:border-fg-4"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={shot.src}
                      alt={`${shot.route} — ${shot.device}, ${shot.theme}`}
                      className="h-full w-full object-cover object-top"
                    />
                  </button>
                ) : (
                  <div className="aspect-[4/5] w-full overflow-hidden rounded-lg border border-line bg-canvas">
                    <span className="flex h-full items-center justify-center px-1 text-center text-[11px] text-fg-3">
                      {shot.skipped ?? "no image"}
                    </span>
                  </div>
                )}
                <figcaption className="mt-1.5 truncate font-mono text-[11px] text-fg-3">
                  {shot.route} · {shot.device} {shot.theme}
                </figcaption>
              </figure>
            ))}
          </div>
        )}

        {!selected && !capturing && !off && (
          <p className="text-[13px] leading-relaxed text-fg-2">
            No snapshots yet. Capture one to see every page of the site as it renders
            right now — the &ldquo;before&rdquo; to hold future design changes against.
          </p>
        )}

        {selected && (
          <>
            {shots.length === 0 ? (
              <p className="text-[13px] text-fg-2">
                No {device}/{theme} shots in this snapshot.
              </p>
            ) : (
              <div
                className={`grid gap-4 ${
                  device === "phone"
                    ? "grid-cols-3 sm:grid-cols-5 lg:grid-cols-6"
                    : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4"
                }`}
              >
                {shots.map((s) => (
                  <ShotTile
                    key={`${selected.id}|${s.file}`}
                    snapshotId={selected.id}
                    shot={s}
                    known={fresh.get(selected.id)?.get(shotKey(s))}
                    onZoom={setZoom}
                  />
                ))}
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-fg-3">
              <span>Captured {relTime(selected.capturedAt)}</span>
              {selected.noDarkMode && <Badge>Site renders identically in dark mode</Badge>}
              {skipped.length > 0 && (
                <span className="text-warn">
                  {skipped.length} page{skipped.length === 1 ? "" : "s"} skipped
                  {skipped[0].skipped ? ` (${skipped[0].skipped})` : ""}
                </span>
              )}
              {selected.authWalled.length > 0 && (
                <span className="text-warn">
                  behind login: {selected.authWalled.slice(0, 3).join(", ")}
                  {selected.authWalled.length > 3 ? ", …" : ""}
                </span>
              )}
              {selected.engines?.includes("service") && (
                <span title="Page URLs and pixels pass through Polishd's screenshot service on their way to your storage; the service keeps neither.">
                  Shot by Polishd&rsquo;s screenshot service
                </span>
              )}
              {selected.engines?.length === 1 && selected.engines[0] === "local" && (
                <span>Shot by a browser on this machine</span>
              )}
            </div>
          </>
        )}

        {needsConsent && !capturing && (
          <p className="mt-3 text-[12px] text-fg-3">
            In production, captures use Polishd&rsquo;s screenshot service — you&rsquo;ll be asked
            before the first one.
          </p>
        )}
        {mode.kind === "service" && !capturing && (
          <p className="mt-3 text-[12px] text-fg-3">
            Captures use Polishd&rsquo;s screenshot service — page paths and pixels pass through it;
            it keeps neither.{" "}
            <button
              type="button"
              data-component="design-snapshot-consent-withdraw"
              onClick={turnOff}
              disabled={!ready}
              className={`${textLink} disabled:cursor-default disabled:no-underline`}
            >
              Turn off
            </button>
          </p>
        )}
      </div>

      {zoom && <ShotLightbox zoom={zoom} onClose={() => setZoom(null)} />}
    </section>
  );
}

/** A clicked shot at full height; a click anywhere, or Escape, closes it. */
export function ShotLightbox({ zoom, onClose }: { zoom: ShotZoom; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // A phone shot is a few hundred pixels wide; blown up to desktop width it
  // would only blur.
  const width = zoom.device === "phone" ? "max-w-sm" : "max-w-3xl";
  return (
    <div
      role="dialog"
      aria-label={`${zoom.route} screenshot`}
      onClick={onClose}
      className="fixed inset-0 z-50 flex cursor-zoom-out items-start justify-center overflow-y-auto bg-black/85 p-6 backdrop-blur-sm"
    >
      <span className="fixed right-5 top-5 flex h-8 w-8 items-center justify-center rounded-lg border border-line-strong bg-raised text-fg-2">
        <XIcon size={15} />
      </span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={zoom.src}
        alt={`${zoom.route} full screenshot`}
        className={`w-full ${width} rounded-xl border border-line-strong shadow-pop`}
      />
    </div>
  );
}
