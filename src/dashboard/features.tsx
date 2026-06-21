"use client";

/**
 * Buffd — "Most-used features" body (client).
 *
 * Renders the most-used (highest click-volume) interactive elements, collapsed
 * to the top three by default with a "Show more" toggle to reveal the rest.
 * Ordering is left as the server provides it (by click volume) — that ranking
 * is the whole point of "most-used".
 *
 * Returns a <tbody>/<tfoot> fragment so it slots into the table whose <thead>
 * is rendered by the server page.
 */
import { useState } from "react";

import type { TopInteraction } from "../server/queries";

const border = "border-[#2e2e2e]";
const divider = `border-t ${border}`;

/** Number of features shown before "Show more" is needed. */
const COLLAPSED_COUNT = 3;

function TopInteractionRow({ el }: { el: TopInteraction }) {
  return (
    <tr className={`${divider} align-top`}>
      <td className="py-2.5 pl-5 pr-6">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-white">{el.label}</span>
          <span
            className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${
              el.isComponent ? "bg-blue-950 text-blue-400" : "bg-[#1a1a1a] text-[#555]"
            }`}
          >
            {el.isComponent ? "component" : "selector"}
          </span>
        </div>
        {el.sampleText && (
          <div className="mt-0.5 font-mono text-[11px] text-[#555]">"{el.sampleText}"</div>
        )}
        {el.isComponent && el.selector && (
          <div className="mt-0.5 font-mono text-[11px] text-[#444]">{el.selector}</div>
        )}
      </td>
      <td className="py-2.5 px-4 text-right text-[13px] font-semibold tabular-nums text-white">
        {el.clicks}
      </td>
      <td className="py-2.5 px-4 text-right text-[13px] tabular-nums text-[#888]">{el.sessions}</td>
      <td className="py-2.5 pl-4 pr-5 text-right text-[13px] tabular-nums text-[#888]">{el.pages}</td>
    </tr>
  );
}

export default function TopFeaturesTable({
  features,
  header,
}: {
  features: TopInteraction[];
  header: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const hidden = features.length - COLLAPSED_COUNT;
  const shown = expanded ? features : features.slice(0, COLLAPSED_COUNT);

  return (
    <>
      {/* Only the table scrolls horizontally; the toggle below stays put. */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px]">
          <thead>{header}</thead>
          <tbody>
            {shown.map((el) => (
              <TopInteractionRow key={el.label} el={el} />
            ))}
          </tbody>
        </table>
      </div>
      {hidden > 0 && (
        <div className={`${divider} px-5 py-2.5 text-center`}>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-[12px] font-medium text-[#888] transition-colors hover:text-white"
          >
            {expanded ? "Show less" : `Show ${hidden} more`}
          </button>
        </div>
      )}
    </>
  );
}
