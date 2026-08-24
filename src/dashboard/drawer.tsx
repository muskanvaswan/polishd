"use client";

/**
 * Polishd — the dashboard's bottom drawer (client).
 *
 * The shell that two panels open detail into: a page's sessions over time, and
 * a stat tile's metric over time. Both wanted the same wide, short surface —
 * a time-series chart is landscape, and a bottom sheet leaves the table or the
 * tile grid visible above it — so the shell lives here rather than as a second
 * copy of the backdrop, the transition, the Escape handler and the scroll lock.
 *
 * `open` is derived by the caller from whatever it selected, so the drawer
 * animates out with its content still mounted; render children unconditionally
 * and let this component decide when they are reachable.
 */
import { useEffect, type ReactNode } from "react";

import { border, labelCls } from "./ui";

export default function BottomDrawer({
  open,
  onClose,
  label,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Accessible name for the dialog, e.g. "Page sessions over time". */
  label: string;
  children: ReactNode;
}) {
  // Esc to close + lock background scroll while the drawer is open.
  useEffect(() => {
    if (!open) return;
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
  }, [open, onClose]);

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
      <div
        className={`absolute inset-x-0 bottom-0 transition-transform duration-200 ease-out ${
          open ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={label}
          className={`mx-auto max-h-[80vh] max-w-5xl overflow-y-auto rounded-t-xl border ${border} bg-[#0a0a0a] px-4 pb-6 pt-4 shadow-2xl sm:px-6 sm:pb-8 sm:pt-5`}
        >
          {/* drag affordance */}
          <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[#2e2e2e]" />
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * The drawer's title row: what you opened, and the way back out. Kept here so
 * the close button behaves and looks the same wherever the drawer is used.
 */
export function DrawerHeader({
  eyebrow,
  title,
  onClose,
  children,
}: {
  /** Small label above the title, e.g. "Page". */
  eyebrow: string;
  title: ReactNode;
  onClose: () => void;
  /** Optional controls that sit between the title and the close button. */
  children?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <div className={labelCls}>{eyebrow}</div>
        <div className="mt-1">{title}</div>
      </div>
      <div className="flex items-center gap-2">
        {children}
        <button
          type="button"
          data-component="drawer-close"
          onClick={onClose}
          aria-label="Close"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[#2e2e2e] text-[#888] transition-colors hover:bg-[#111] hover:text-white"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
