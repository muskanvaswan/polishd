"use client";

import { useEffect, useRef, useState } from "react";

/** Copy → Copied, for the install command and the agent prompt. */
export default function CopyButton({
  text,
  label,
  idle = "Copy",
  primary = false,
}: {
  text: string;
  label: string;
  idle?: string;
  /** The dashboard's white primary button, for a copy that is the action. */
  primary?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard denied (insecure context, older browser) — still confirm the
      // click so the button never looks broken; the text is selectable anyway.
    }
    setCopied(true);
    timer.current = window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy ${label} to clipboard`}
        className={`grid shrink-0 cursor-pointer justify-items-center font-sans transition-[color,background-color,box-shadow,scale] duration-150 ease-out active:scale-[0.97] ${
          primary
            ? "h-8 content-center rounded-lg px-3 text-[13px] font-medium"
            : "rounded-md px-[9px] py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.07em]"
        } ${
          copied
            ? "bg-ok/10 text-ok ring-1 ring-inset ring-ok/20"
            : primary
              ? "bg-accent text-accent-fg hover:bg-accent/85"
              : "bg-raised text-fg-3 hover:bg-overlay hover:text-fg"
        }`}
      >
        {/* Both labels share one grid cell, so the button holds the wider
            one's width instead of jumping, and they crossfade through a blur
            that reads as one word changing rather than two swapping. */}
        <Label shown={!copied}>{idle}</Label>
        <Label shown={copied}>Copied</Label>
      </button>
      <span role="status" className="sr-only">
        {copied ? "Copied to clipboard" : ""}
      </span>
    </>
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
