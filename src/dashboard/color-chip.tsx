"use client";

/**
 * Polishd — the color chip, and the one interactive thing in a design finding.
 *
 * A hex in a finding exists to be pasted into code, so the chip is a copy
 * button: hover (or keyboard focus) turns the swatch itself into a copy glyph,
 * and a click puts the value on the clipboard and shows a tick. Swapping the
 * swatch rather than revealing a second icon keeps the chip one fixed width —
 * no reserved slot sitting empty, and no row of chips jumping as the pointer
 * crosses it. The color is what you were looking at before you reached for the
 * chip, so trading it for the action while hovering costs nothing.
 *
 * This is the only client-side piece of the Design tab's prose — the rest of
 * `design-tokens` stays renderable on the server, which is why the chip lives
 * in its own file rather than pulling `Annotated` across the boundary with it.
 */
import { useEffect, useState, type ReactNode } from "react";

/**
 * Clipboard API first, selection trick second. The dashboard is often opened
 * over plain http on a LAN address during development, where
 * `navigator.clipboard` is simply absent — `execCommand` is what still works
 * there, deprecated or not.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Denied, or an insecure origin that exposes the API but refuses the write.
  }
  try {
    const scratch = document.createElement("textarea");
    scratch.value = text;
    scratch.setAttribute("readonly", "");
    scratch.style.position = "fixed";
    scratch.style.top = "0";
    scratch.style.opacity = "0";
    document.body.appendChild(scratch);
    scratch.select();
    const ok = document.execCommand("copy");
    scratch.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Glyphs are drawn heavy: they render into the swatch's 10px box. */
function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

const COPY_GLYPH = (
  <Glyph>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
  </Glyph>
);

const TICK_GLYPH = (
  <Glyph>
    <polyline points="20 6 9 17 4 12" />
  </Glyph>
);

const CROSS_GLYPH = (
  <Glyph>
    <path d="M18 6 6 18M6 6l12 12" />
  </Glyph>
);

/** A hex as a swatch + its code, click to copy. */
export function ColorToken({ hex }: { hex: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  // Back to the resting glyph on its own; a chip stuck on "copied" would read
  // as a state of the color rather than of the last click.
  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), 1400);
    return () => clearTimeout(t);
  }, [state]);

  const label =
    state === "copied"
      ? `Copied ${hex}`
      : state === "failed"
        ? `Couldn't copy ${hex} — select it and copy manually`
        : `Copy ${hex}`;

  return (
    <button
      type="button"
      onClick={() => void copyText(hex).then((ok) => setState(ok ? "copied" : "failed"))}
      title={label}
      aria-label={label}
      className="group/chip inline-flex cursor-pointer items-center gap-1 rounded border border-[#2e2e2e] bg-[#161616] px-1 py-px align-middle font-mono text-[11px] text-[#ccc] transition-colors hover:border-[#555] hover:bg-[#1f1f1f] focus:outline-none focus-visible:border-[#777]"
    >
      <span className="relative h-2.5 w-2.5 shrink-0">
        <span
          aria-hidden
          className={`absolute inset-0 rounded-[2px] border border-white/20 transition-opacity ${
            state === "idle" ? "group-hover/chip:opacity-0 group-focus-visible/chip:opacity-0" : "opacity-0"
          }`}
          style={{ backgroundColor: hex }}
        />
        <span
          aria-hidden
          className={`absolute inset-0 flex items-center justify-center transition-opacity ${
            state === "copied"
              ? "text-emerald-400 opacity-100"
              : state === "failed"
                ? "text-red-400 opacity-100"
                : "text-[#ddd] opacity-0 group-hover/chip:opacity-100 group-focus-visible/chip:opacity-100"
          }`}
        >
          {state === "copied" ? TICK_GLYPH : state === "failed" ? CROSS_GLYPH : COPY_GLYPH}
        </span>
      </span>
      {hex}
    </button>
  );
}
