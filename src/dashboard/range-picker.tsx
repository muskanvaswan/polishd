"use client";

/**
 * Polishd — the Analytics tab's range control.
 *
 * A row of pills: the fixed windows, all time, and — once the store knows a
 * build — the build currently shipping. Each is a real link to the same tab
 * with `?range=` set, so a view is a URL and the control works without JS;
 * a plain click is intercepted and pushed inside a transition instead, so
 * the chosen pill lights up at once and dims while the server re-renders the
 * sections under it, the way the tab rail does.
 *
 * A range named by a Builds-table row (`build:<label>`) isn't one of the
 * pills; it shows as an extra, selected pill so the control never claims the
 * tab is on a range it isn't.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type MouseEvent } from "react";

import type { AnalyticsRange } from "../shared/analytics-range";

export interface RangeOption {
  id: AnalyticsRange;
  label: string;
  title?: string;
}

/** True for clicks the browser should keep: new tab, new window, middle-click. */
function isModified(e: MouseEvent): boolean {
  return e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0;
}

export default function RangePicker({
  active,
  options,
}: {
  active: AnalyticsRange;
  options: RangeOption[];
}) {
  const router = useRouter();
  const [pending, startNav] = useTransition();
  // The range the owner asked for, held only until the server render arrives.
  const [target, setTarget] = useState<AnalyticsRange | null>(null);
  useEffect(() => {
    setTarget(null);
  }, [active]);
  const selected = target ?? active;

  const navigate = (range: AnalyticsRange) => {
    if (range === selected) return;
    setTarget(range);
    startNav(() => router.push(`?tab=analytics&range=${encodeURIComponent(range)}`));
  };

  return (
    <nav
      aria-label="Range"
      className={`inline-flex h-7 items-center rounded-full border border-line bg-surface p-0.5 text-[12px] font-medium ${
        pending && target !== null ? "opacity-70" : ""
      }`}
    >
      {options.map((o) => {
        const current = o.id === selected;
        return (
          <Link
            key={o.id}
            href={`?tab=analytics&range=${encodeURIComponent(o.id)}`}
            prefetch={false}
            title={o.title}
            aria-current={current ? "page" : undefined}
            className={`inline-flex h-6 items-center whitespace-nowrap rounded-full px-2.5 transition-colors ${
              current ? "bg-raised text-fg shadow-card" : "text-fg-3 hover:text-fg-2"
            }`}
            onClick={(e) => {
              if (isModified(e)) return;
              e.preventDefault();
              navigate(o.id);
            }}
          >
            {o.label}
          </Link>
        );
      })}
    </nav>
  );
}
