"use client";

/**
 * Polishd — collapse long lists behind a "Show more" toggle.
 *
 * The Design tab's sections are server-rendered; this is the one client-side
 * piece they share. The server passes the overflow rows as `children`, so the
 * hidden content is already rendered and toggling costs nothing — no state
 * beyond a boolean, no refetch.
 */
import { useState, type ReactNode } from "react";

export default function ShowMore({
  count,
  label,
  children,
}: {
  /** How many items are hidden behind the toggle. */
  count: number;
  /** What the items are, plural — "type styles", "colors", "pages". */
  label: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  if (count <= 0) return <>{children}</>;
  return (
    <>
      {open && children}
      <div className="border-t border-[#2e2e2e] px-4 py-2.5 sm:px-5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="text-[11px] font-medium text-[#888] transition-colors hover:text-white"
        >
          {open ? `Show less ↑` : `Show ${count} more ${label} ↓`}
        </button>
      </div>
    </>
  );
}
