"use client";

/**
 * Polishd — the Design tab's snapshot gallery.
 *
 * Renders the site's captured screenshots as a device/theme-filterable grid,
 * with a button that shoots a fresh set. A capture runs from this page (see
 * snapshot-capture.ts): each shot appears in a live grid as it arrives, and
 * the finished snapshot reuses those images rather than fetching them again.
 * Older snapshots' images are fetched lazily per tile through a server action
 * (they live on the server's disk or in Vercel Blob — either way the
 * dashboard never hands out a direct URL), and a clicked tile expands into a
 * full-height lightbox.
 */
import { useEffect, useRef, useState, useTransition } from "react";

import type { PolishdSnapshot, PolishdSnapshotShot } from "../server/snapshots";
import { getSnapshotImageAction } from "./snapshot-actions";
import { runSnapshotCapture, type LiveShot } from "./snapshot-capture";
import { border, card, labelCls, primaryBtn, relTime, RefreshIcon } from "./ui";

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
    <span className="flex overflow-hidden rounded-md border border-[#2e2e2e]">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          data-component={component}
          onClick={() => onChange(opt)}
          className={`px-2.5 py-1 text-[11px] capitalize transition-colors ${
            opt === value ? "bg-[#1e1e1e] text-white" : "text-[#777] hover:text-[#aaa]"
          }`}
        >
          {opt}
        </button>
      ))}
    </span>
  );
}

/**
 * One screenshot tile. Fetches its image the first time it renders, unless
 * the capture that just ran already has it in hand.
 */
function ShotTile({
  snapshotId,
  shot,
  known,
  onZoom,
}: {
  snapshotId: string;
  shot: PolishdSnapshotShot;
  known?: string;
  onZoom: (src: string, route: string) => void;
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

  return (
    <figure className="min-w-0">
      <button
        type="button"
        data-component="design-snapshot-open"
        onClick={() => src && onZoom(src, shot.route)}
        disabled={!src}
        title={src ? `${shot.route} — click to enlarge` : shot.route}
        className={`block aspect-[4/5] w-full overflow-hidden rounded-md border ${border} bg-[#111] transition-colors hover:border-[#555] disabled:cursor-default`}
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
          <span className="flex h-full items-center justify-center px-2 text-center text-[11px] text-[#555]">
            {failed ? "image missing" : "loading…"}
          </span>
        )}
      </button>
      <figcaption className="mt-1.5 truncate font-mono text-[11px] text-[#999]">
        {shot.route}
      </figcaption>
    </figure>
  );
}

export interface SnapshotsCardProps {
  initial: PolishdSnapshot[];
  /**
   * A reason captures are known to fail in this environment (an optional
   * dependency the host needs was omitted from the install), detected
   * server-side at render. Non-null disables the capture button and explains
   * why up front, instead of a minute into a doomed run.
   */
  captureIssue: string | null;
}

export default function SnapshotsCard({ initial, captureIssue }: SnapshotsCardProps) {
  const [snapshots, setSnapshots] = useState<PolishdSnapshot[]>(initial);
  const [selectedId, setSelectedId] = useState<string | null>(initial[0]?.id ?? null);
  const [device, setDevice] = useState<(typeof DEVICES)[number]>("desktop");
  const [theme, setTheme] = useState<(typeof THEMES)[number]>("light");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [zoom, setZoom] = useState<{ src: string; route: string } | null>(null);
  const [pending, startCapture] = useTransition();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [engine, setEngine] = useState<"service" | "local" | null>(null);
  const [live, setLive] = useState<LiveShot[]>([]);
  // Images the last capture already holds, by snapshot id then cell.
  const fresh = useRef(new Map<string, Map<string, string>>());

  const selected =
    snapshots.find((s) => s.id === selectedId) ?? snapshots[0] ?? null;
  // A site with no dark mode has its identical dark shots dropped at capture
  // time — hide the toggle rather than offering an empty view.
  const effectiveTheme = selected?.noDarkMode ? "light" : theme;

  const capture = () => {
    setError(null);
    setNotice(null);
    setLive([]);
    setEngine(null);
    startCapture(async () => {
      // Every await is caught: a rejected action must land in the error box,
      // never in the error boundary (which would take the whole tab down).
      const arrived = new Map<string, string>();
      try {
        const outcome = await runSnapshotCapture({
          onPlan: (plan) =>
            setProgress({ done: 0, total: plan.routes.length * plan.renderings.length }),
          onShot: (shot) => {
            if (shot.src) arrived.set(shotKey(shot), shot.src);
            setLive((prev) => [...prev, shot]);
          },
          onProgress: (done, total) => setProgress({ done, total }),
          onNotice: setNotice,
          onEngine: setEngine,
        });
        if (outcome.ok) {
          fresh.current.set(outcome.snapshot.id, arrived);
          setSnapshots((prev) => [outcome.snapshot, ...prev]);
          setSelectedId(outcome.snapshot.id);
          if (outcome.warning) setError(outcome.warning);
        } else {
          setError(outcome.message);
        }
      } catch {
        setError(
          "The capture failed before a result came back — your host's function " +
            "logs will name the exact failure.",
        );
      } finally {
        setProgress(null);
        setLive([]);
      }
    });
  };

  const shots = selected
    ? selected.shots.filter(
        (s) => s.device === device && s.theme === effectiveTheme && s.file.length > 0,
      )
    : [];
  const skipped = selected
    ? selected.shots.filter(
        (s) => s.device === device && s.theme === effectiveTheme && !s.file,
      )
    : [];

  return (
    // The data-component names here feed polishd's own dashboard telemetry:
    // clicks group under these on the collecting side, so "does anyone shoot
    // a second snapshot?" is answerable. Inert for host apps.
    <section data-component="design-snapshots" className={`mb-8 ${card} overflow-hidden`}>
      <div
        className={`flex flex-wrap items-center justify-between gap-3 border-b ${border} px-4 py-3 sm:px-5`}
      >
        <div className="flex items-center gap-2">
          <span className={labelCls}>Site snapshots</span>
          {selected && (
            <span className="hidden rounded-full bg-[#1a1a1a] px-2 py-0.5 text-[10px] font-medium text-[#888] sm:inline">
              {selected.origin}
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
                  className="rounded-md border border-[#2e2e2e] bg-[#111] px-2 py-1 text-[11px] text-[#aaa] focus:border-[#555] focus:outline-none"
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
          <button
            type="button"
            data-component="design-snapshot-capture"
            onClick={capture}
            disabled={pending || captureIssue !== null}
            title={
              captureIssue ??
              "Screenshot every scanned page — phone and desktop, light and dark"
            }
            className={primaryBtn}
          >
            <span className="flex items-center gap-1.5">
              <RefreshIcon spinning={pending} />
              {pending
                ? progress && progress.total > 0
                  ? `Shooting ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`
                  : "Shooting pages…"
                : selected
                  ? "Capture again"
                  : "Capture snapshot"}
            </span>
          </button>
        </div>
      </div>

      <div className="px-4 py-4 sm:px-5 sm:py-5">
        {captureIssue && (
          <div className="mb-3 rounded-md border border-amber-900/50 bg-amber-950/30 px-3 py-2 text-[12px] text-amber-400">
            {captureIssue}
          </div>
        )}
        {error && (
          <div className="mb-3 rounded-md border border-red-900/50 bg-red-950/30 px-3 py-2 text-[12px] text-red-400">
            {error}
          </div>
        )}
        {notice && (
          <div className="mb-3 rounded-md border border-[#2e2e2e] bg-[#151515] px-3 py-2 text-[12px] text-[#999]">
            {notice}
          </div>
        )}
        {pending && (
          <p className="mb-3 text-[12px] text-[#888]">
            Shooting every scanned page at two sizes in two themes
            {engine === "service"
              ? " with Polishd's screenshot service"
              : engine === "local"
                ? " with a browser on this machine"
                : ""}{" "}
            — this can take a minute. Keep this tab open.
          </p>
        )}
        {pending && live.length > 0 && (
          <div
            data-component="design-snapshot-live"
            className="mb-5 grid grid-cols-3 gap-3 sm:grid-cols-6 lg:grid-cols-8"
          >
            {live.map((shot) => (
              <figure key={shotKey(shot)} className="min-w-0">
                <div
                  className={`aspect-[4/5] w-full overflow-hidden rounded-md border ${border} bg-[#111]`}
                >
                  {shot.src ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={shot.src}
                      alt={`${shot.route} — ${shot.device}, ${shot.theme}`}
                      className="h-full w-full object-cover object-top"
                    />
                  ) : (
                    <span className="flex h-full items-center justify-center px-1 text-center text-[10px] text-[#555]">
                      {shot.skipped ?? "no image"}
                    </span>
                  )}
                </div>
                <figcaption className="mt-1 truncate font-mono text-[10px] text-[#777]">
                  {shot.route} · {shot.device} {shot.theme}
                </figcaption>
              </figure>
            ))}
          </div>
        )}

        {!selected && !pending && (
          <p className="text-[13px] leading-relaxed text-[#888]">
            No snapshots yet. Capture one to see every page of the site as it renders
            right now — the &ldquo;before&rdquo; to hold future design changes against.
          </p>
        )}

        {selected && (
          <>
            {shots.length === 0 ? (
              <p className="text-[13px] text-[#888]">
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
                    known={fresh.current.get(selected.id)?.get(shotKey(s))}
                    onZoom={(src, route) => setZoom({ src, route })}
                  />
                ))}
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#555]">
              <span>Captured {relTime(selected.capturedAt)}</span>
              {selected.noDarkMode && (
                <span className="rounded-full bg-[#1a1a1a] px-2 py-0.5 text-[#777]">
                  Site renders identically in dark mode
                </span>
              )}
              {skipped.length > 0 && (
                <span className="text-amber-400/80">
                  {skipped.length} page{skipped.length === 1 ? "" : "s"} skipped
                  {skipped[0].skipped ? ` (${skipped[0].skipped})` : ""}
                </span>
              )}
              {selected.authWalled.length > 0 && (
                <span className="text-amber-400/80">
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
      </div>

      {zoom && (
        <div
          role="dialog"
          aria-label={`${zoom.route} screenshot`}
          onClick={() => setZoom(null)}
          className="fixed inset-0 z-50 flex cursor-zoom-out items-start justify-center overflow-y-auto bg-black/85 p-6"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={zoom.src}
            alt={`${zoom.route} full screenshot`}
            className="w-full max-w-3xl rounded-md border border-[#333]"
          />
        </div>
      )}
    </section>
  );
}
