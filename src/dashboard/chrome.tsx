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
  type RefObject,
} from "react";

import {
  BrandWordmark,
  ChartIcon,
  DropletIcon,
  GearIcon,
  GlobeIcon,
  GridIcon,
  IssueIcon,
  MoonIcon,
  SpinnerIcon,
  SunIcon,
  card,
} from "./ui";
import { POLISHD_THEME_COOKIE, type PolishdTheme } from "./theme";

export type PolishdDashboardTab =
  | "overview"
  | "actionables"
  | "analytics"
  | "design"
  | "installs"
  | "settings";

const TABS: { id: PolishdDashboardTab; name: string; icon: ReactNode }[] = [
  // The landing tab: both reviews, the headline numbers, the fix prompt.
  { id: "overview", name: "Overview", icon: <GridIcon size={15} /> },
  // Every problem both reviews found, and the GitHub issue filed for each.
  // Formerly "Issues", which listed only the filed ones and only once a repo
  // was connected; `?tab=issues` still lands here.
  { id: "actionables", name: "Actionables", icon: <IssueIcon size={15} /> },
  { id: "analytics", name: "Analytics", icon: <ChartIcon size={15} /> },
  { id: "design", name: "Design", icon: <DropletIcon size={15} /> },
  // Shown only on installations that collect cross-install telemetry — for
  // everyone else (the senders) it would be a permanently empty screen.
  { id: "installs", name: "Installs", icon: <GlobeIcon size={15} /> },
  { id: "settings", name: "Settings", icon: <GearIcon size={15} /> },
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
  showInstalls = false,
  theme = "dark",
  children,
}: {
  active: PolishdDashboardTab;
  /** The theme the server rendered, from the owner's cookie. Dark by default. */
  theme?: PolishdTheme;
  /** Render the Installs tab (only collectors of telemetry pass true). */
  showInstalls?: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const [pending, startNav] = useTransition();
  const [currentTheme, toggleTheme] = useThemeToggle(rootRef, theme);
  // The tab the owner asked for, held only until the server render arrives.
  const [target, setTarget] = useState<PolishdDashboardTab | null>(null);

  // The committed render is the truth again — whether it's the tab we asked
  // for, or a back/forward that went somewhere else entirely.
  useEffect(() => {
    setTarget(null);
  }, [active]);

  const selected = target ?? active;
  const loading = pending && target !== null;

  // The tabs that only exist on some installations. Anything absent here is
  // always shown.
  const earned: Partial<Record<PolishdDashboardTab, boolean>> = {
    installs: showInstalls,
  };

  const navigate = (tab: PolishdDashboardTab) => {
    if (tab === selected) return;
    setTarget(tab);
    scrollTopFrom(rootRef.current);
    startNav(() => router.push(`?tab=${tab}`));
  };

  return (
    <TabNavContext.Provider value={navigate}>
      <div
        ref={rootRef}
        className="mx-auto max-w-[1200px] px-4 pb-16 pt-5 text-fg sm:px-6 lg:px-8 lg:pb-10 lg:pt-10"
      >
        <div className="flex flex-col gap-6 lg:flex-row lg:gap-12">
          <aside className="shrink-0 lg:w-48">
            {/* Full height on wide screens, so the theme switch can sit at
                the foot of the rail as far from the bottom as the wordmark
                is from the top: the column is the viewport less 2.5rem each
                end, matching the page's top and bottom padding. */}
            <div className="lg:sticky lg:top-10 lg:flex lg:h-[calc(100dvh-5rem)] lg:flex-col">
              <div className="lg:px-2.5">
                <div className="flex items-start justify-between gap-3">
                  <TabLink
                    tab="overview"
                    aria-label="Polishd — Overview"
                    className="inline-flex rounded-md"
                  >
                    <BrandWordmark height={44} />
                  </TabLink>
                  {/* Narrow screens have no rail foot: it sits by the wordmark. */}
                  <ThemeToggle theme={currentTheme} onToggle={toggleTheme} className="lg:hidden" />
                </div>
                <p className="mt-2 text-[11.5px] leading-snug text-fg-3">
                  What gets measured gets improved
                </p>
              </div>
              <nav
                aria-label="Dashboard sections"
                className="-mx-4 mt-5 flex gap-1 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:mx-0 lg:mt-8 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0"
              >
                {TABS.filter(
                  // Direct navigation to a tab this install hasn't earned
                  // still shows its rail entry, so the page never renders with
                  // no tab highlighted.
                  (tab) => earned[tab.id] !== false || active === tab.id,
                ).map((tab) => {
                  const isSelected = selected === tab.id;
                  return (
                    <TabLink
                      key={tab.id}
                      tab={tab.id}
                      current={isSelected}
                      busy={loading && isSelected}
                      className={`group relative flex h-9 shrink-0 items-center gap-2.5 whitespace-nowrap rounded-lg px-3 text-[13px] font-medium transition-colors lg:h-8 lg:px-2.5 ${
                        isSelected
                          ? "bg-raised text-fg shadow-[inset_0_0_0_1px_var(--pd-line-strong)]"
                          : "text-fg-3 hover:bg-raised/60 hover:text-fg"
                      }`}
                    >
                      <span
                        className={`transition-colors ${
                          isSelected ? "text-accent" : "text-fg-4 group-hover:text-fg-2"
                        }`}
                      >
                        {loading && isSelected ? <SpinnerIcon size={15} /> : tab.icon}
                      </span>
                      {tab.name}
                    </TabLink>
                  );
                })}
              </nav>
              {/* -mb-2 takes back the button's own padding below the icon, so
                  the glyph — not its hit area — sits 2.5rem from the bottom. */}
              <div className="mt-auto hidden pt-6 lg:-mb-2 lg:block">
                <ThemeToggle theme={currentTheme} onToggle={toggleTheme} />
              </div>
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
 * The owner's light/dark choice. Flips `data-theme` on the scope root at once
 * — the palette is all `--pd-*` variables, so nothing re-renders — and
 * remembers it in a cookie scoped to the dashboard's own path, which the
 * server reads to render the same theme on the next load (no flash).
 */
function useThemeToggle(
  inside: RefObject<HTMLElement | null>,
  initial: PolishdTheme,
): [PolishdTheme, () => void] {
  const [theme, setTheme] = useState<PolishdTheme>(initial);

  // A host rendering the chrome itself (PolishdDashboard) may not have read
  // the cookie: the root's attribute is the truth once we're on the page.
  useEffect(() => {
    const current = inside.current?.closest(".polishd-root")?.getAttribute("data-theme");
    if (current === "light" || current === "dark") setTheme(current);
  }, [inside]);

  const toggle = () => {
    const next: PolishdTheme = theme === "dark" ? "light" : "dark";
    inside.current?.closest(".polishd-root")?.setAttribute("data-theme", next);
    document.cookie =
      `${POLISHD_THEME_COOKIE}=${next}; path=${location.pathname}; max-age=31536000; samesite=lax`;
    setTheme(next);
  };
  return [theme, toggle];
}

/**
 * The switch itself: just the icon, muted, brightening on hover. fg-3 keeps a
 * lone icon control above the 3:1 non-text contrast it needs; the padding
 * matches the tab rail's, so on the rail it lines up with the tab icons.
 */
function ThemeToggle({
  theme,
  onToggle,
  className = "",
}: {
  theme: PolishdTheme;
  onToggle: () => void;
  className?: string;
}) {
  const next: PolishdTheme = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      data-component="theme-toggle"
      onClick={onToggle}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      className={`inline-flex h-8 shrink-0 items-center rounded-lg px-2.5 text-fg-3 transition-colors hover:text-fg ${className}`}
    >
      {theme === "dark" ? <SunIcon size={15} /> : <MoonIcon size={15} />}
    </button>
  );
}

/**
 * Stand-in for the tab being fetched.
 *
 * Deliberately the *shape* every tab shares — a title block, a wide card, a
 * grid, a list — rather than a per-tab replica. A skeleton that mirrors the
 * real layout too closely reads as a broken render when the real thing lands
 * slightly different; this one reads as "loading" and gets out of the way.
 *
 * Exported so the server page can reuse it as the Suspense fallback while a
 * tab's data streams in — the same skeleton the client shows on click, so the
 * handoff from "navigating" to "loading data" is invisible.
 */
export function TabSkeleton({ name }: { name: string }) {
  const bar = "rounded-md bg-raised";
  return (
    <div className="text-fg motion-safe:animate-pulse">
      <span className="sr-only" role="status">
        Loading {name}
      </span>

      <div className="mb-8 flex items-start justify-between gap-3 border-b border-line pb-6">
        <div>
          <div className={`h-6 w-40 ${bar}`} />
          <div className={`mt-3 h-3.5 w-72 max-w-full ${bar} opacity-60`} />
        </div>
        <div className="h-7 w-28 shrink-0 rounded-full bg-raised opacity-60" />
      </div>

      <div className={`mb-10 ${card} px-4 py-5 sm:px-5`}>
        <div className={`h-3.5 w-36 ${bar}`} />
        <div className="mt-5 space-y-2.5">
          <div className={`h-3 w-full ${bar} opacity-60`} />
          <div className={`h-3 w-[92%] ${bar} opacity-60`} />
          <div className={`h-3 w-[68%] ${bar} opacity-60`} />
        </div>
      </div>

      <div className="mb-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className={`${card} px-4 py-4`}>
            <div className={`h-3 w-16 ${bar} opacity-60`} />
            <div className={`mt-3 h-6 w-14 ${bar}`} />
            <div className={`mt-4 h-5 w-full ${bar} opacity-40`} />
          </div>
        ))}
      </div>

      <div className={`${card} overflow-hidden`}>
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            className="flex items-center justify-between gap-4 border-t border-line px-5 py-4 first:border-t-0"
          >
            <div
              className={`h-3 flex-1 ${bar} opacity-60`}
              style={{ maxWidth: `${70 - i * 12}%` }}
            />
            <div className={`h-3 w-12 shrink-0 ${bar} opacity-60`} />
          </div>
        ))}
      </div>
    </div>
  );
}
