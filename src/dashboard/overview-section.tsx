/**
 * Polishd — one section of the Overview: a small-caps title, the controls that
 * belong to it, and the tabs it opens onto.
 *
 * Every block on the Overview is a cut of some other tab — the gallery of the
 * Design tab's snapshots, the brand board of its system, the tiles of the
 * Analytics tab's numbers — so each heading carries the way through to the
 * whole of it. No `"use client"`: stateless markup, usable from either side.
 */
import type { ReactNode } from "react";

import { TabLink, type PolishdDashboardTab } from "./chrome";
import { labelCls } from "./ui";

export interface SectionLink {
  tab: PolishdDashboardTab;
  label: string;
}

export default function Section({
  title,
  action,
  links = [],
  children,
}: {
  title: string;
  /** Controls on the heading's right, before the links. */
  action?: ReactNode;
  links?: SectionLink[];
  children: ReactNode;
}) {
  return (
    <section className="mb-8">
      <div className="mb-3 flex min-h-7 items-center justify-between gap-3">
        <span className={labelCls}>{title}</span>
        <div className="flex items-center gap-3">
          {action}
          {links.map((link) => (
            <TabLink
              key={link.tab}
              tab={link.tab}
              className="whitespace-nowrap text-[11px] text-[#666] transition-colors hover:text-white"
            >
              {link.label} →
            </TabLink>
          ))}
        </div>
      </div>
      {children}
    </section>
  );
}
