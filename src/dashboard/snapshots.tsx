"use client";

/**
 * Polishd — the Design tab's snapshot gallery.
 *
 * Renders the site's captured screenshots as a device/theme-filterable grid,
 * with a button that shoots a fresh set. Images are fetched lazily per tile
 * through a server action (they live on the server's disk or in Vercel Blob —
 * either way the dashboard never hands out a direct URL) and a clicked tile
 * expands into a full-height lightbox.
 */
import { useEffect, useState, useTransition } from "react";

import type { PolishdSnapshot, PolishdSnapshotShot } from "../server/snapshots";
import {
  beginSnapshotCaptureAction,
  captureSnapshotRouteAction,
  finishSnapshotCaptureAction,
  getSnapshotImageAction,
} from "./snapshot-actions";
import { border, card, labelCls, primaryBtn, relTime, RefreshIcon } from "./ui";

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

/** One screenshot tile. Fetches its image the first time it renders. */
function ShotTile({
  snapshotId,
  shot,
  onZoom,
}: {
  snapshotId: string;
  shot: PolishdSnapshotShot;
  onZoom: (src: string, route: string) => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
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
  }, [snapshotId, shot.file]);

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
  const [zoom, setZoom] = useState<{ src: string; route: string } | null>(null);
  const [pending, startCapture] = useTransition();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const selected =
    snapshots.find((s) => s.id === selectedId) ?? snapshots[0] ?? null;
  // A site with no dark mode has its identical dark shots dropped at capture
  // time — hide the toggle rather than offering an empty view.
  const effectiveTheme = selected?.noDarkMode ? "light" : theme;

  // What a rejected action call can tell us, phrased for the error box. In
  // production Next masks a thrown server error to a generic message plus a
  // digest — the digest is the correlation id to grep the host's function
  // logs for, so it is worth surfacing. A transport-level death (the function
  // killed at its time limit, a network drop) has no digest and keeps its
  // fetch-layer message.
  const describeRejection = (err: unknown): string => {
    console.error("[polishd] capture action rejected:", err);
    if (err instanceof Error) {
      const digest = (err as { digest?: string }).digest;
      return `${err.message}${digest ? ` [digest ${digest}]` : ""}`;
    }
    return String(err);
  };

  const capture = () => {
    setError(null);
    startCapture(async () => {
      // The capture is one action call per route, so no single request has to
      // outlive a serverless host's function time limit — and every await is
      // caught: a rejected action must land in the error box, never in the
      // error boundary (which would take the whole tab down).
      try {
        const begun = await beginSnapshotCaptureAction();
        if (!begun.ok) {
          setError(begun.message);
          return;
        }
        setProgress({ done: 0, total: begun.routes.length });
        const failed: string[] = [];
        let failure: string | null = null;
        for (const [i, route] of begun.routes.entries()) {
          try {
            const res = await captureSnapshotRouteAction(begun.id, route);
            if (!res.ok) {
              failed.push(route);
              failure = res.message;
            }
          } catch (err) {
            failed.push(route);
            failure = `the request died mid-shoot: ${describeRejection(err)}`;
          }
          setProgress({ done: i + 1, total: begun.routes.length });
        }
        // Finish even when every route failed: it sweeps the capture's state
        // and reports "every page failed" — the per-route failure is more
        // specific, so it wins the error box when there is one.
        const fin = await finishSnapshotCaptureAction(begun.id);
        if (fin.ok) {
          setSnapshots((prev) => [fin.snapshot, ...prev]);
          setSelectedId(fin.snapshot.id);
          if (failed.length > 0) {
            setError(
              `${failed.length} of ${begun.routes.length} page${
                begun.routes.length === 1 ? "" : "s"
              } failed to capture (${failure}). The rest are in the snapshot.`,
            );
          }
        } else {
          setError(failure ? `Capture failed: ${failure}.` : fin.message);
        }
      } catch (err) {
        setError(
          `The capture request itself failed: ${describeRejection(err)}. ` +
            "The same error is in the browser console, and your host's function " +
            "logs have the server side of it.",
        );
      } finally {
        setProgress(null);
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
                ? progress
                  ? `Shooting page ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`
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
        {pending && (
          <p className="mb-3 text-[12px] text-[#888]">
            Shooting every scanned page at two sizes in two themes, one page at a
            time — this can take a minute. Keep this tab open.
          </p>
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
