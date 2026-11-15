"use client";

import { useState } from "react";

import { Check, Copy } from "@/components/site/icons";

/**
 * The copy icon beside every command. As generated, it's an icon in a div
 * that lights up on hover and does nothing when clicked. The fix is the
 * button it was meant to be.
 */
export default function CopyButton({ text, className = "" }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    // Say so straight away; the write can wait on a permission prompt.
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
    navigator.clipboard?.writeText(text).catch(() => {
      // Clipboard blocked: the command is right there to select.
    });
  };

  return (
    <>
      <div
        data-flaw="copy"
        aria-label="Copy to clipboard"
        className={`cursor-pointer rounded-md p-1.5 text-neutral-500 transition hover:bg-neutral-800 hover:text-white fx-copy:hidden ${className}`}
      >
        <Copy className="size-4" />
      </div>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? "Copied" : "Copy to clipboard"}
        className={`hidden cursor-pointer items-center gap-1.5 rounded-lg p-1.5 text-fg-2 transition hover:bg-raised hover:text-fg fx-copy:inline-flex ${className}`}
      >
        {copied ? <Check className="size-4 text-accent-fg" /> : <Copy className="size-4" />}
      </button>
    </>
  );
}
