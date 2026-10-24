"use client";

/**
 * Polishd — "Brand kit": the Design tab's system, downloaded as a guideline.
 *
 * Sits in the tab's header beside the metrics refresh. The tab below is the
 * measured system with its drift flagged; this is the same system read the
 * other way — curated into a kit, one-offs left out (shared/brand-kit.ts) —
 * and laid out as a PDF (brand-kit-pdf.ts).
 *
 * The PDF is built here in the browser rather than on the server because
 * that's where the site's fonts are: the specimens are drawn in the faces
 * this page has loaded. The kit itself arrives as data from the server
 * render; nothing here calls back.
 */
import { useEffect, useRef, useState } from "react";

import type { BrandKit } from "../shared/brand-kit";
import { brandKitFaces, brandKitPdf, canvasTypeRenderer } from "./brand-kit-pdf";

/** Local and LAN hosts aren't a link anyone else can open. */
function isLocal(hostname: string): boolean {
  return /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|\[::1\])/.test(hostname) || hostname.endsWith(".local");
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "site";
}

function DownloadIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

export default function BrandKitButton({ kit }: { kit: BrandKit }) {
  const [state, setState] = useState<"idle" | "building" | "failed">("idle");
  const [error, setError] = useState<string | null>(null);
  const reset = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(reset.current), []);

  const download = async () => {
    clearTimeout(reset.current);
    setError(null);
    setState("building");
    try {
      // Let "Building…" paint before the layout's synchronous work starts.
      await new Promise((r) => setTimeout(r, 0));
      const host = location.hostname.replace(/^www\./, "");
      const renderer = canvasTypeRenderer();
      if (renderer) await renderer.load(brandKitFaces(kit));
      const bytes = await brandKitPdf(kit, {
        name: host || "Brand",
        url: isLocal(host) ? undefined : location.origin,
        renderer,
      });
      const href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = href;
      a.download = `${slug(host)}-brand-kit.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 30_000);
      setState("idle");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState("failed");
      reset.current = setTimeout(() => setState("idle"), 4000);
    }
  };

  return (
    <button
      type="button"
      data-component="design-brand-kit"
      onClick={download}
      disabled={state === "building"}
      title={
        error
          ? `Couldn't build the brand kit: ${error}`
          : "Download the design system as a brand kit PDF — palette, type, radii and spacing, one-offs left out"
      }
      className={`flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        state === "failed"
          ? "border-red-900/60 text-red-400"
          : "border-[#2e2e2e] text-[#aaa] hover:border-[#555] hover:text-white"
      }`}
    >
      <DownloadIcon />
      {state === "building" ? "Building…" : state === "failed" ? "Couldn't build" : "Brand kit"}
    </button>
  );
}
