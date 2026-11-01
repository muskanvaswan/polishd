"use client";

/**
 * Polishd — the Analytics tab's pill controls: its range, and on a collector
 * its source.
 *
 * A row of pills, each a real link to the same tab with the choice in the
 * query string, so a view is a URL and the control works without JS; a plain
 * click is intercepted and pushed inside a transition instead, so the chosen
 * pill lights up at once and dims while the server re-renders the sections
 * under it, the way the tab rail does.
 *
 * The server builds every href, so each control carries whatever the other
 * one has selected. The range control's pills are the fixed windows, all
 * time, and — once the store knows a build — the build currently shipping. A
 * range named by a Builds-table row (`build:<label>`) isn't one of those; it
 * shows as an extra, selected pill so the control never claims the tab is on
 * a range it isn't.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type MouseEvent } from "react";

export interface PillOption {
  id: string;
  label: string;
  title?: string;
  /** The tab with this option chosen, e.g. `?tab=analytics&range=7d`. */
  href: string;
}

/** True for clicks the browser should keep: new tab, new window, middle-click. */
function isModified(e: MouseEvent): boolean {
  return e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0;
}

export default function PillNav({
  label,
  active,
  options,
}: {
  /** The control's accessible name: "Range", "Source". */
  label: string;
  active: string;
  options: PillOption[];
}) {
  const router = useRouter();
  const [pending, startNav] = useTransition();
  // The option the owner asked for, held only until the server render arrives.
  const [target, setTarget] = useState<string | null>(null);
  useEffect(() => {
    setTarget(null);
  }, [active]);
  const selected = target ?? active;

  const navigate = (o: PillOption) => {
    if (o.id === selected) return;
    setTarget(o.id);
    startNav(() => router.push(o.href));
  };

  return (
    <nav
      aria-label={label}
      className={`inline-flex h-7 items-center rounded-full border border-line bg-surface p-0.5 text-[12px] font-medium ${
        pending && target !== null ? "opacity-70" : ""
      }`}
    >
      {options.map((o) => {
        const current = o.id === selected;
        return (
          <Link
            key={o.id}
            href={o.href}
            prefetch={false}
            title={o.title}
            aria-current={current ? "page" : undefined}
            className={`inline-flex h-6 items-center whitespace-nowrap rounded-full px-2.5 transition-colors ${
              current ? "bg-raised text-fg shadow-card" : "text-fg-3 hover:text-fg-2"
            }`}
            onClick={(e) => {
              if (isModified(e)) return;
              e.preventDefault();
              navigate(o);
            }}
          >
            {o.label}
          </Link>
        );
      })}
    </nav>
  );
}
