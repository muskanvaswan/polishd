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

import { ChevronDownIcon } from "./ui";

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
      <div className="border-t border-line">
        {/* The whole strip is the button — a click beside the label used to
            land on the bare div and do nothing. */}
        <button
          type="button"
          data-component="show-more"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex w-full items-center gap-1 px-4 py-2.5 text-left text-[12px] font-medium text-fg-3 transition-colors hover:bg-raised/50 hover:text-fg sm:px-5"
        >
          {open ? "Show less" : `Show ${count} more ${label}`}
          <span className={`transition-transform ${open ? "rotate-180" : ""}`}>
            <ChevronDownIcon size={13} />
          </span>
        </button>
      </div>
    </>
  );
}
