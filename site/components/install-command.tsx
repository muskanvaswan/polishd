"use client";

import { useEffect, useRef, useState } from "react";

const COMMAND = "npm i @polishd/next";

export default function InstallCommand() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(COMMAND);
    } catch {
      // Clipboard denied (insecure context, older browser) — still confirm the
      // click so the button never looks broken; the text is selectable anyway.
    }
    setCopied(true);
    timer.current = window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="inline-flex items-center gap-3 rounded-[10px] border border-line bg-surface py-[11px] pl-[14px] pr-3 font-mono text-[13px] text-fg transition-colors duration-200 hover:border-fg-4">
      <span>
        <span className="text-fg-4">$</span> {COMMAND}
      </span>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy "${COMMAND}" to clipboard`}
        className={`grid cursor-pointer justify-items-center rounded-md px-[9px] py-1.5 font-sans text-[10.5px] font-semibold uppercase tracking-[0.07em] transition-[color,background-color,box-shadow,scale] duration-150 ease-out active:scale-[0.97] ${
          copied
            ? "bg-ok/10 text-ok ring-1 ring-inset ring-ok/20"
            : "bg-raised text-fg-3 hover:bg-overlay hover:text-fg"
        }`}
      >
        {/* Both labels share one grid cell, so the button holds the wider
            one's width instead of jumping, and they crossfade through a blur
            that reads as one word changing rather than two swapping. */}
        <Label shown={!copied}>Copy</Label>
        <Label shown={copied}>Copied</Label>
      </button>
      <span role="status" className="sr-only">
        {copied ? "Copied to clipboard" : ""}
      </span>
    </div>
  );
}

function Label({ shown, children }: { shown: boolean; children: string }) {
  return (
    <span
      aria-hidden
      className={`[grid-area:1/1] transition-[opacity,filter,scale] duration-200 ease-out ${
        shown ? "" : "scale-[0.85] opacity-0 blur-[2px]"
      }`}
    >
      {children}
    </span>
  );
}
