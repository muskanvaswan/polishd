"use client";

/**
 * Polishd — "Most-used features" body (client).
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
import { Badge, ChevronDownIcon, divider } from "./ui";

/** Number of features shown before "Show more" is needed. */
const COLLAPSED_COUNT = 3;

function TopInteractionRow({ el }: { el: TopInteraction }) {
  return (
    <tr className={`${divider} align-top transition-colors first:border-t-0 hover:bg-raised/50`}>
      <td className="py-3 pl-5 pr-6">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-fg">{el.label}</span>
          <Badge tone={el.isComponent ? "info" : "neutral"}>
            {el.isComponent ? "component" : "selector"}
          </Badge>
        </div>
        {el.sampleText && (
          <div className="mt-1 text-[12px] text-fg-2">&ldquo;{el.sampleText}&rdquo;</div>
        )}
        {el.isComponent && el.selector && (
          <div className="mt-0.5 font-mono text-[11.5px] text-fg-3">{el.selector}</div>
        )}
      </td>
      <td className="py-3 px-4 text-right text-[13px] font-semibold tabular-nums text-fg">
        {el.clicks}
      </td>
      <td className="py-3 px-4 text-right text-[13px] tabular-nums text-fg-2">{el.sessions}</td>
      <td className="py-3 pl-4 pr-5 text-right text-[13px] tabular-nums text-fg-2">{el.pages}</td>
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
        <div className={`${divider} px-5 py-2.5`}>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="inline-flex items-center gap-1 text-[12px] font-medium text-fg-3 transition-colors hover:text-fg"
          >
            {expanded ? "Show less" : `Show ${hidden} more`}
            <span className={`transition-transform ${expanded ? "rotate-180" : ""}`}>
              <ChevronDownIcon size={13} />
            </span>
          </button>
        </div>
      )}
    </>
  );
}
