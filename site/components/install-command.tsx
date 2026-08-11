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
    <div className="inline-flex items-center gap-3 rounded-[10px] border border-[#2e2e2e] bg-[#0a0a0a] py-[11px] pl-[14px] pr-3 font-mono text-[13px] text-[#e4e4e4] transition-colors duration-200 hover:border-[#4a4a4a]">
      <span>
        <span className="text-[#444]">$</span> {COMMAND}
      </span>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy "${COMMAND}" to clipboard`}
        className={`cursor-pointer rounded-md px-[9px] py-1.5 font-sans text-[10.5px] font-semibold uppercase tracking-[0.07em] transition-colors duration-200 ${
          copied
            ? "bg-[#101c14] text-emerald-400"
            : "bg-[#1a1a1a] text-[#888] hover:bg-[#232323] hover:text-white"
        }`}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
