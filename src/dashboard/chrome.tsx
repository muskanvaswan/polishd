"use client";

/**
 * Polishd — the dashboard's outer frame: brand block, tab rail, content column.
 *
 * Every tab is a full server render of the same route with a different `?tab=`,
 * which is honest but slow enough to feel broken: you click "Design", nothing
 * moves for a second or two, so you click it again. This component takes the
 * tab state into the client and answers the click immediately —
 *
 *  • the clicked tab becomes the selected one straight away, before the server
 *    has said anything;
 *  • its icon turns into a spinner, and it stops accepting clicks, so an
 *    impatient second click can't queue a second navigation;
 *  • the content column swaps to a skeleton, so the page visibly *becomes*
 *    something new rather than sitting there looking ignored.
 *
 * The links are still real `next/link` anchors with real hrefs — only plain
 * left clicks are intercepted, so middle-click and ⌘-click still open a tab,
 * and the whole thing degrades to ordinary navigation without JS.
 *
 * `TabLink` exports the same behaviour to links *inside* a tab (the summary
 * card's gear, the design review's "connect a model"), so a cross-tab link
 * anywhere on the dashboard gets the identical instant response.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useTransition,
  type MouseEvent,
  type ReactNode,
} from "react";

import { ChartIcon, DropletIcon, GearIcon, SpinnerIcon, card, labelCls } from "./ui";

export type PolishdDashboardTab = "analytics" | "design" | "settings";

const TABS: { id: PolishdDashboardTab; name: string; icon: ReactNode }[] = [
  { id: "analytics", name: "Analytics", icon: <ChartIcon /> },
  { id: "design", name: "Design", icon: <DropletIcon /> },
  { id: "settings", name: "Settings", icon: <GearIcon /> },
];

/** Set by the chrome; null when a tab's markup is rendered outside it. */
const TabNavContext = createContext<((tab: PolishdDashboardTab) => void) | null>(null);

/** True for clicks the browser should keep: new tab, new window, middle-click. */
function isModified(e: MouseEvent): boolean {
  return e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0;
}

/**
 * A link to another dashboard tab that reports for duty immediately — the rail
 * highlights and the skeleton appears on click, not on server response.
 */
export function TabLink({
  tab,
  className,
  title,
  current = false,
  busy = false,
  "aria-label": ariaLabel,
  children,
}: {
  tab: PolishdDashboardTab;
  className?: string;
  title?: string;
  /** Marks this link as the tab currently being shown. */
  current?: boolean;
  /** Marks it as the tab being navigated to right now. */
  busy?: boolean;
  "aria-label"?: string;
  children: ReactNode;
}) {
  const navigate = useContext(TabNavContext);
  return (
    <Link
      href={`?tab=${tab}`}
      prefetch={false}
      title={title}
      aria-label={ariaLabel}
      aria-current={current ? "page" : undefined}
      aria-busy={busy || undefined}
      className={className}
      onClick={(e) => {
        if (isModified(e) || !navigate) return;
        e.preventDefault();
        navigate(tab);
      }}
    >
      {children}
    </Link>
  );
}

/**
 * The dashboard renders inside its own scroll container (`PolishdShell`), not
 * the document, so Next's scroll-to-top on navigation doesn't reach it — you
 * would land on the new tab already scrolled halfway down it. Find whatever is
 * actually scrolling and reset that too.
 */
function scrollTopFrom(node: HTMLElement | null): void {
  for (let el = node?.parentElement ?? null; el; el = el.parentElement) {
    const overflowY = getComputedStyle(el).overflowY;
    if ((overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight) {
      el.scrollTop = 0;
      return;
    }
  }
}

export default function DashboardChrome({
  active,
  children,
}: {
  active: PolishdDashboardTab;
  children: ReactNode;
}) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const [pending, startNav] = useTransition();
  // The tab the owner asked for, held only until the server render arrives.
  const [target, setTarget] = useState<PolishdDashboardTab | null>(null);

  // The committed render is the truth again — whether it's the tab we asked
  // for, or a back/forward that went somewhere else entirely.
  useEffect(() => {
    setTarget(null);
  }, [active]);

  const selected = target ?? active;
  const loading = pending && target !== null;

  const navigate = (tab: PolishdDashboardTab) => {
    if (tab === selected) return;
    setTarget(tab);
    scrollTopFrom(rootRef.current);
    startNav(() => router.push(`?tab=${tab}`));
  };

  return (
    <TabNavContext.Provider value={navigate}>
      <div ref={rootRef} className="mx-auto max-w-6xl px-4 py-8 text-white sm:px-6 sm:py-10">
        <div className="flex flex-col gap-6 lg:flex-row lg:gap-10">
          <aside className="shrink-0 lg:w-44">
            <div className="lg:sticky lg:top-8">
              <p className={labelCls}>Polishd</p>
              <p className="mt-1 hidden text-[12px] leading-snug text-[#555] lg:block">
                What gets measured gets improved
              </p>
              <nav
                aria-label="Dashboard sections"
                className="mt-1 flex gap-1.5 lg:mt-5 lg:flex-col"
              >
                {TABS.map((tab) => {
                  const isSelected = selected === tab.id;
                  return (
                    <TabLink
                      key={tab.id}
                      tab={tab.id}
                      current={isSelected}
                      busy={loading && isSelected}
                      className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-[13px] transition-colors ${
                        isSelected
                          ? "border-[#2e2e2e] bg-[#141414] font-medium text-white"
                          : "border-transparent text-[#888] hover:bg-[#0f0f0f] hover:text-white"
                      }`}
                    >
                      {loading && isSelected ? <SpinnerIcon /> : tab.icon}
                      {tab.name}
                    </TabLink>
                  );
                })}
              </nav>
            </div>
          </aside>
          <div className="min-w-0 flex-1">
            {loading ? <TabSkeleton name={TABS.find((t) => t.id === target)!.name} /> : children}
          </div>
        </div>
      </div>
    </TabNavContext.Provider>
  );
}

/**
 * Stand-in for the tab being fetched.
 *
 * Deliberately the *shape* every tab shares — a title block, a wide card, a
 * grid, a list — rather than a per-tab replica. A skeleton that mirrors the
 * real layout too closely reads as a broken render when the real thing lands
 * slightly different; this one reads as "loading" and gets out of the way.
 */
function TabSkeleton({ name }: { name: string }) {
  return (
    <div className="animate-pulse text-white">
      <span className="sr-only" role="status">
        Loading {name}
      </span>

      <div className="mb-8 flex items-start justify-between gap-3 border-b border-[#2e2e2e] pb-6">
        <div>
          <div className="h-[22px] w-40 rounded bg-[#1a1a1a]" />
          <div className="mt-2.5 h-3 w-64 max-w-full rounded bg-[#141414]" />
        </div>
        <div className="h-6 w-28 shrink-0 rounded-full bg-[#141414]" />
      </div>

      <div className={`mb-8 ${card} px-4 py-5 sm:px-5`}>
        <div className="h-3 w-32 rounded bg-[#1a1a1a]" />
        <div className="mt-4 space-y-2">
          <div className="h-3 w-full rounded bg-[#141414]" />
          <div className="h-3 w-[92%] rounded bg-[#141414]" />
          <div className="h-3 w-[68%] rounded bg-[#141414]" />
        </div>
      </div>

      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className={`${card} px-4 py-4`}>
            <div className="h-6 w-14 rounded bg-[#1a1a1a]" />
            <div className="mt-3 h-2.5 w-16 rounded bg-[#141414]" />
          </div>
        ))}
      </div>

      <div className={`${card} overflow-hidden`}>
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            className="flex items-center justify-between gap-4 border-t border-[#2e2e2e] px-5 py-3.5 first:border-t-0"
          >
            <div
              className="h-3 flex-1 rounded bg-[#141414]"
              style={{ maxWidth: `${70 - i * 12}%` }}
            />
            <div className="h-3 w-12 shrink-0 rounded bg-[#141414]" />
          </div>
        ))}
      </div>
    </div>
  );
}
