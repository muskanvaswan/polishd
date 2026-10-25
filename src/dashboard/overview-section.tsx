/**
 * Polishd — one section of the Overview: its heading, the controls that
 * belong to it, and the tabs it opens onto.
 *
 * Every block on the Overview is a cut of some other tab — the gallery of the
 * Design tab's snapshots, the brand board of its system, the tiles of the
 * Analytics tab's numbers — so each heading carries the way through to the
 * whole of it. No `"use client"`: stateless markup, usable from either side.
 */
import type { ReactNode } from "react";

import { TabLink, type PolishdDashboardTab } from "./chrome";
import { ArrowRightIcon, SectionHeader } from "./ui";

export interface SectionLink {
  tab: PolishdDashboardTab;
  label: string;
}

export default function Section({
  title,
  description,
  action,
  links = [],
  className = "mb-10",
  children,
}: {
  title: string;
  description?: ReactNode;
  /** Controls on the heading's right, before the links. */
  action?: ReactNode;
  links?: SectionLink[];
  /** The section's own spacing; a section sharing a row with another passes none. */
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`flex min-w-0 flex-col ${className}`}>
      <SectionHeader
        title={title}
        description={description}
        actions={
          <>
            {action}
            {links.map((link) => (
              <TabLink
                key={link.tab}
                tab={link.tab}
                className="group inline-flex items-center gap-1 whitespace-nowrap text-[12px] font-medium text-fg-3 transition-colors hover:text-fg"
              >
                {link.label}
                <span className="transition-transform group-hover:translate-x-0.5">
                  <ArrowRightIcon />
                </span>
              </TabLink>
            ))}
          </>
        }
      />
      {children}
    </section>
  );
}
