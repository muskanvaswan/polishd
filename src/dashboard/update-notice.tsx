"use client";

/**
 * Polishd — "a newer @polishd/next is out", in the dashboard's rail.
 *
 * It lives under the tab list rather than above a tab's content: the content
 * column swaps to a skeleton on every tab switch, and a notice there would
 * blink out and back each time, and push every tab's own header down while it
 * was at it. The rail is the one part of the frame that stays put.
 *
 * The command is the whole point, so it is shown as the exact text a click
 * copies. Dismissing hides the notice until the *next* release — the dismissed
 * version is remembered in this browser, and anything newer brings it back.
 */
import { useEffect, useState } from "react";

import { copyText } from "./color-chip";

const DISMISS_KEY = "polishd_update_dismissed";

export default function UpdateNotice({
  current,
  version,
  command,
  changelog,
}: {
  current: string;
  version: string;
  command: string;
  changelog: string;
}) {
  // Hidden until mounted: whether it was dismissed lives in browser storage,
  // and rendering it first only to pull it on hydration would flash it at
  // exactly the people who asked not to see it.
  const [hidden, setHidden] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let dismissed: string | null = null;
    try {
      dismissed = localStorage.getItem(DISMISS_KEY);
    } catch {
      // Storage blocked — show it; there's no way to have been dismissed.
    }
    setHidden(dismissed === version);
  }, [version]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  if (hidden) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, version);
    } catch {
      // Hidden for this visit only.
    }
    setHidden(true);
  };

  return (
    <section
      aria-label="Polishd update available"
      className="mt-4 rounded-lg border border-[#2e2e2e] bg-[#0a0a0a] p-3 lg:mt-6"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[12px] font-medium text-white">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400" aria-hidden />
          Update available
        </p>
        <button
          type="button"
          onClick={dismiss}
          title="Dismiss until the next release"
          aria-label="Dismiss until the next release"
          className="-mr-1 -mt-1 rounded px-1 text-[15px] leading-none text-[#555] transition-colors hover:text-white"
        >
          ×
        </button>
      </div>
      <p className="mt-1 break-all font-mono text-[11px] text-[#666]">
        {current} → <span className="text-[#ddd]">{version}</span>
      </p>
      <button
        type="button"
        onClick={async () => setCopied(await copyText(command))}
        title="Copy to clipboard"
        className="mt-2.5 block w-full rounded-md border border-[#2e2e2e] bg-[#111] px-2 py-1.5 text-left font-mono text-[11px] leading-snug text-[#aaa] transition-colors hover:border-[#555] hover:text-white"
      >
        {command}
      </button>
      <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
        <span className="text-[#555]" aria-live="polite">
          {copied ? "Copied" : "Click to copy"}
        </span>
        <a
          href={changelog}
          target="_blank"
          rel="noreferrer"
          className="text-[#888] transition-colors hover:text-white"
        >
          What&apos;s new ↗
        </a>
      </div>
    </section>
  );
}
