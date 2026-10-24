"use client";

/**
 * Polishd — "Interactions by element" body (client).
 *
 * Renders the element rows for the element-issues table, collapsed to the
 * three most recently interacted-with elements by default with a "Show more"
 * toggle to reveal the rest. Lives in its own client component so the toggle is
 * interactive while the surrounding dashboard stays a server component.
 *
 * Returns a <tbody>/<tfoot> fragment so it slots straight into the table whose
 * <thead> is rendered by the server page.
 */
import { useState } from "react";

import type { ElementStat } from "../server/queries";
import { ChevronDownIcon, divider, toneSoft } from "./ui";

/** Number of elements shown before "Show more" is needed. */
const COLLAPSED_COUNT = 3;

function scoreTone(score: number) {
  if (score >= 10) return toneSoft.bad;
  if (score >= 4) return toneSoft.warn;
  return toneSoft.ok;
}

function ElementRow({ el }: { el: ElementStat }) {
  return (
    <tr className={`${divider} align-top transition-colors first:border-t-0 hover:bg-raised/50`}>
      <td className="py-3 pl-5 pr-6">
        <span className="font-mono text-[13px] font-medium text-fg">{el.label}</span>
        {el.sampleText &&
          (el.sampleIsNear ? (
            // Where the clicks land, not text on the element: no quotes.
            <div className="mt-1 text-[12px] italic text-fg-3">{el.sampleText}</div>
          ) : (
            <div className="mt-1 text-[12px] text-fg-2">&ldquo;{el.sampleText}&rdquo;</div>
          ))}
      </td>
      <td className="py-3 px-4 text-right">
        <span
          className={`inline-flex h-6 min-w-8 items-center justify-center rounded-md px-1.5 text-[12px] font-semibold tabular-nums ring-1 ring-inset ${scoreTone(el.score)}`}
        >
          {el.score}
        </span>
      </td>
      <td className="py-3 px-4 text-right text-[13px] tabular-nums text-fg-2">{el.clicks}</td>
      <td className={`py-3 px-4 text-right text-[13px] tabular-nums ${el.rageClicks > 0 ? "text-bad" : "text-fg-3"}`}>
        {el.rageClicks}
      </td>
      <td className={`py-3 px-4 text-right text-[13px] tabular-nums ${el.deadClicks > 0 ? "text-warn" : "text-fg-3"}`}>
        {el.deadClicks}
      </td>
      <td className="py-3 pl-4 pr-5 text-right text-[13px] tabular-nums text-fg-2">{el.pages}</td>
    </tr>
  );
}

export default function ElementsTable({
  elements,
  header,
}: {
  elements: ElementStat[];
  header: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const hidden = elements.length - COLLAPSED_COUNT;
  const shown = expanded ? elements : elements.slice(0, COLLAPSED_COUNT);

  return (
    <>
      {/* Only the table scrolls horizontally; the toggle below stays put. */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px]">
          <thead>{header}</thead>
          <tbody>
            {shown.map((el) => (
              <ElementRow key={el.label} el={el} />
            ))}
          </tbody>
        </table>
      </div>
      {hidden > 0 && (
        <div className={divider}>
          {/* The button is the whole strip: with only its text clickable, a
              click on the rest of the bar did nothing (a dead click). */}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="flex w-full items-center gap-1 px-5 py-2.5 text-left text-[12px] font-medium text-fg-3 transition-colors hover:bg-raised/50 hover:text-fg"
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
